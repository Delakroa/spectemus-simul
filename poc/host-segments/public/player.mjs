export const MAX_AHEAD_SECONDS = 12;
export const KEEP_BEHIND_SECONDS = 3;

export function remotePlaybackIntent(state, guestEnded) {
  return state.playing || (state.ended && !guestEnded);
}

export function bufferedAhead(video) {
  for (let index = 0; index < video.buffered.length; index += 1) {
    if (
      video.buffered.start(index) <= video.currentTime + 0.15 &&
      video.buffered.end(index) > video.currentTime
    )
      return video.buffered.end(index) - video.currentTime;
  }
  return 0;
}

function waitEvent(target, name, action, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(name, done);
      target.removeEventListener("error", fail);
      signal.removeEventListener("abort", fail);
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error("MediaSource operation failed or stopped"));
    };
    const timer = setTimeout(fail, 8_000);
    target.addEventListener(name, done, { once: true });
    target.addEventListener("error", fail, { once: true });
    signal.addEventListener("abort", fail, { once: true });
    if (signal.aborted) {
      fail();
      return;
    }
    try {
      action?.();
    } catch {
      fail();
    }
  });
}

export async function createPlayer(video, mime, signal) {
  if (!MediaSource.isTypeSupported(mime))
    throw new Error(
      "Этот браузер не поддерживает кодеки подготовленного файла.",
    );
  const source = new MediaSource();
  const url = URL.createObjectURL(source);
  try {
    const ready = waitEvent(source, "sourceopen", null, signal);
    video.src = url;
    await ready;
    const buffer = source.addSourceBuffer(mime);
    return {
      async append(data) {
        const cutoff = video.currentTime - KEEP_BEHIND_SECONDS;
        if (
          cutoff > 0 &&
          buffer.buffered.length &&
          buffer.buffered.start(0) < cutoff
        ) {
          await waitEvent(
            buffer,
            "updateend",
            () => buffer.remove(0, cutoff),
            signal,
          );
        }
        await waitEvent(
          buffer,
          "updateend",
          () => buffer.appendBuffer(data),
          signal,
        );
      },
      end() {
        if (source.readyState === "open" && !buffer.updating)
          source.endOfStream();
      },
      dispose() {
        video.pause();
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(url);
      },
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export function validManifest(value) {
  return (
    value?.version === 1 &&
    typeof value.mime === "string" &&
    value.mime.length < 150 &&
    /^video\/mp4; codecs="avc1\.[0-9a-f]{6}(, mp4a\.40\.2)?"$/i.test(
      value.mime,
    ) &&
    Number.isSafeInteger(value.size) &&
    value.size > 0 &&
    Number.isFinite(value.duration) &&
    value.duration > 0 &&
    value.chunkBytes === 65536
  );
}
