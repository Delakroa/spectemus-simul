import {
  bufferedAhead,
  createPlayer,
  MAX_AHEAD_SECONDS,
  remotePlaybackIntent,
  validManifest,
} from "./player.mjs";

const byId = (id) => document.getElementById(id);
const parameters = new URLSearchParams(location.hash.slice(1));
const role = parameters.get("role");
const key = parameters.get("key");
history.replaceState(null, "", location.pathname);
const video = byId("video");
byId("role").textContent =
  role === "host" ? "Хост — источник файла" : "Гость — локальное декодирование";
byId("host-controls").hidden = role !== "host";
const lifetime = new AbortController();
let ws, pc, channel, player, manifest;
let busy = false,
  offset = 0,
  requested = false,
  eof = false,
  ended = false;
let bytes = 0,
  peakChannelBytes = 0,
  sequence = 0,
  lastSequence = -1;
let remoteState = null;
const status = (message) => {
  byId("status").textContent = message;
};
const safe = (task) => {
  Promise.resolve()
    .then(task)
    .catch((error) => {
      if (!ended) {
        status(error.message || "Ошибка прототипа");
        stop(false);
      }
    });
};

function stop(update = true) {
  if (ended) return;
  ended = true;
  lifetime.abort();
  channel?.close();
  pc?.close();
  ws?.close();
  player?.dispose();
  byId("connect").disabled = true;
  byId("play").disabled = true;
  byId("pause").disabled = true;
  if (update) status("Сеанс остановлен. Для нового запуска перезапустите PoC.");
}
function send(message) {
  if (channel?.readyState === "open") channel.send(JSON.stringify(message));
}

async function mediaFetch(path, headers = {}) {
  const response = await fetch(path, {
    headers: { Authorization: `Bearer ${key}`, ...headers },
    signal: lifetime.signal,
  });
  if (!response.ok) throw new Error("Локальный host media недоступен.");
  return response;
}

async function gather() {
  if (pc.iceGatheringState === "complete") return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("ICE gathering timeout"));
    }, 10_000);
    const check = () => {
      if (pc.iceGatheringState === "complete") {
        cleanup();
        resolve();
      }
    };
    const abort = () => {
      cleanup();
      reject(new Error("Остановлено"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", check);
      lifetime.signal.removeEventListener("abort", abort);
    };
    pc.addEventListener("icegatheringstatechange", check);
    lifetime.signal.addEventListener("abort", abort, { once: true });
  });
}

async function initPeer() {
  pc = new RTCPeerConnection({ iceServers: [] }); // Только direct/local PoC, без STUN/TURN.
  pc.addEventListener("connectionstatechange", () => {
    if (["failed", "closed"].includes(pc.connectionState) && !ended) {
      status("Соединение прервалось");
      stop(false);
    }
  });
  if (role === "host") {
    setupChannel(pc.createDataChannel("movie-segments", { ordered: true }));
    await pc.setLocalDescription(await pc.createOffer());
    await gather();
    ws.send(JSON.stringify({ type: "sdp", description: pc.localDescription }));
  } else
    pc.addEventListener("datachannel", (event) => setupChannel(event.channel));
}

function setupChannel(value) {
  channel = value;
  channel.binaryType = "arraybuffer";
  channel.addEventListener("close", () => {
    if (!ended) {
      status("Канал закрыт");
      stop(false);
    }
  });
  channel.addEventListener("error", () => {
    if (!ended) {
      status("Ошибка канала");
      stop(false);
    }
  });
  channel.addEventListener("open", () =>
    safe(async () => {
      status("Direct WebRTC подключён. Заполняем ограниченный буфер…");
      if (role === "host") {
        manifest = await (await mediaFetch("/manifest")).json();
        if (!validManifest(manifest)) throw new Error("Некорректный manifest");
        player = await createPlayer(video, manifest.mime, lifetime.signal);
        send({ type: "manifest", value: manifest });
        byId("play").disabled = false;
        byId("pause").disabled = false;
      }
    }),
  );
  channel.addEventListener("message", (event) =>
    safe(() => receive(event.data)),
  );
}

async function receive(data) {
  if (ended) return;
  if (typeof data !== "string") {
    if (
      role !== "guest" ||
      !requested ||
      busy ||
      !manifest ||
      data.byteLength > manifest.chunkBytes ||
      data.byteLength !== Math.min(manifest.chunkBytes, manifest.size - offset)
    )
      throw new Error("Некорректный binary chunk");
    busy = true;
    try {
      await player.append(data);
      if (ended) return;
      offset += data.byteLength;
      bytes += data.byteLength;
      requested = false;
    } finally {
      busy = false;
    }
    if (eof && offset === manifest.size) player.end();
    requestMore();
    return;
  }
  if (data.length > 1024) throw new Error("Слишком большое control message");
  const message = JSON.parse(data);
  if (role === "host") {
    if (
      message.type !== "pull" ||
      busy ||
      !manifest ||
      message.offset !== offset ||
      offset >= manifest.size
    )
      throw new Error("Некорректный pull request");
    busy = true;
    try {
      while (!ended && bufferedAhead(video) >= MAX_AHEAD_SECONDS) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (ended) return;
      const end = Math.min(offset + manifest.chunkBytes, manifest.size) - 1;
      const chunk = await (
        await mediaFetch("/media", { Range: `bytes=${offset}-${end}` })
      ).arrayBuffer();
      if (chunk.byteLength !== end - offset + 1)
        throw new Error("Неполный fragment");
      await player.append(chunk);
      if (ended) return;
      channel.send(chunk);
      offset += chunk.byteLength;
      bytes += chunk.byteLength;
      peakChannelBytes = Math.max(peakChannelBytes, channel.bufferedAmount);
      if (offset === manifest.size) {
        player.end();
        send({ type: "eof" });
      }
    } finally {
      busy = false;
    }
    return;
  }
  if (message.type === "manifest") {
    if (manifest || !validManifest(message.value))
      throw new Error("Некорректный manifest");
    manifest = message.value;
    player = await createPlayer(video, manifest.mime, lifetime.signal);
    requestMore();
  } else if (message.type === "state") {
    if (
      !Number.isSafeInteger(message.sequence) ||
      message.sequence <= lastSequence ||
      typeof message.playing !== "boolean" ||
      typeof message.ended !== "boolean" ||
      !Number.isFinite(message.position) ||
      message.position < 0
    )
      return;
    lastSequence = message.sequence;
    remoteState = message;
    await applyState();
  } else if (message.type === "eof") {
    eof = true;
    if (!busy && manifest && offset === manifest.size) player.end();
  } else throw new Error("Неизвестное control message");
}

function requestMore() {
  if (
    role !== "guest" ||
    ended ||
    !player ||
    requested ||
    busy ||
    offset >= manifest.size ||
    bufferedAhead(video) >= MAX_AHEAD_SECONDS
  )
    return;
  requested = true;
  send({ type: "pull", offset });
}
async function applyState() {
  if (!player || !remoteState || ended) return;
  if (video.ended && remoteState.ended) return;
  const target = remoteState.position;
  for (let i = 0; i < video.buffered.length; i += 1) {
    if (
      target >= video.buffered.start(i) &&
      target < video.buffered.end(i) &&
      Math.abs(video.currentTime - target) > 0.6
    )
      video.currentTime = target;
  }
  if (!remotePlaybackIntent(remoteState, video.ended)) {
    video.pause();
    return;
  }
  if (video.paused) {
    try {
      await video.play();
      byId("enable").hidden = true;
    } catch {
      if (!ended) {
        byId("enable").hidden = false;
        status("Нажмите «Разрешить воспроизведение» в окне гостя.");
      }
    }
  }
}
function broadcastState() {
  if (role === "host")
    send({
      type: "state",
      sequence: sequence++,
      playing: !video.paused && !video.ended,
      ended: video.ended,
      position: video.currentTime,
    });
}

byId("connect").addEventListener("click", () =>
  safe(async () => {
    if (
      !["host", "guest"].includes(role) ||
      !/^[A-Za-z0-9_-]{43}$/.test(key ?? "")
    )
      throw new Error("Откройте полную ссылку, выданную командой запуска.");
    byId("connect").disabled = true;
    ws = new WebSocket(`${location.origin.replace("http:", "ws:")}/signal`);
    ws.addEventListener("open", () =>
      ws.send(JSON.stringify({ type: "auth", role, key })),
    );
    ws.addEventListener("message", (event) =>
      safe(async () => {
        const message = JSON.parse(event.data);
        if (message.type === "paired") await initPeer();
        else if (message.type === "sdp" && pc) {
          await pc.setRemoteDescription(message.description);
          if (role === "guest") {
            await pc.setLocalDescription(await pc.createAnswer());
            await gather();
            ws.send(
              JSON.stringify({ type: "sdp", description: pc.localDescription }),
            );
          }
        } else throw new Error("Ошибка signaling");
      }),
    );
    ws.addEventListener("close", () => {
      if (!ended) {
        status("Локальный signaling закрыт");
        stop(false);
      }
    });
    ws.addEventListener("error", () => {
      if (!ended) {
        status("Локальный signaling недоступен");
        stop(false);
      }
    });
  }),
);
byId("play").addEventListener("click", () =>
  safe(async () => {
    await video.play();
    broadcastState();
  }),
);
byId("pause").addEventListener("click", () => {
  video.pause();
  broadcastState();
});
byId("enable").addEventListener("click", () =>
  safe(async () => {
    await video.play();
    byId("enable").hidden = true;
  }),
);
byId("stop").addEventListener("click", () => stop());
window.addEventListener("pagehide", () => stop(false), { once: true });
video.addEventListener("ended", broadcastState);
const timer = setInterval(() => {
  if (ended) {
    clearInterval(timer);
    return;
  }
  requestMore();
  broadcastState();
  byId("metrics").textContent = JSON.stringify(
    {
      role,
      connection: pc?.connectionState ?? "new",
      iceState: pc?.iceConnectionState ?? "new",
      signalingState: pc?.signalingState ?? "new",
      localCandidateCount: (
        pc?.localDescription?.sdp?.match(/^a=candidate:/gm) ?? []
      ).length,
      remoteCandidateCount: (
        pc?.remoteDescription?.sdp?.match(/^a=candidate:/gm) ?? []
      ).length,
      bytes,
      size: manifest?.size ?? 0,
      aheadSeconds: Number(bufferedAhead(video).toFixed(2)),
      peakChannelBytes,
      currentTime: Number(video.currentTime.toFixed(2)),
      decodedFrames: video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0,
      finished: eof || (manifest && offset === manifest.size) || false,
    },
    null,
    2,
  );
}, 500);
