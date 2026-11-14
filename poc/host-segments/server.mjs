import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readFile, open } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { CHUNK_BYTES, prepareMovie } from "./prepare.mjs";

const PUBLIC = new URL("./public/", import.meta.url);
const STATIC = new Map([
  ["/", ["index.html", "text/html"]],
  ["/app.mjs", ["app.mjs", "text/javascript"]],
  ["/player.mjs", ["player.mjs", "text/javascript"]],
  ["/style.css", ["style.css", "text/css"]],
]);

function matches(value, secret) {
  if (typeof value !== "string") return false;
  const supplied = Buffer.from(value);
  const expected = Buffer.from(secret);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

export async function startPoc({
  mediaPath,
  manifest,
  port = 0,
  lifetimeMs = 30 * 60_000,
}) {
  const tokens = {
    host: randomBytes(32).toString("base64url"),
    guest: randomBytes(32).toString("base64url"),
  };
  const peers = new Map();
  let origin;
  let finished = false;
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    perMessageDeflate: false,
  });
  const finish = () => {
    if (finished) return;
    finished = true;
    for (const peer of wss.clients) peer.terminate();
    peers.clear();
  };
  async function handle(request, response) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src blob:; base-uri 'none'; frame-ancestors 'none'",
    );
    if (
      request.headers.host !== new URL(origin).host ||
      request.method !== "GET"
    ) {
      response.writeHead(403).end();
      return;
    }
    let url;
    try {
      url = new URL(request.url, origin);
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (STATIC.has(url.pathname)) {
      const [file, type] = STATIC.get(url.pathname);
      response
        .writeHead(200, { "Content-Type": type })
        .end(await readFile(new URL(file, PUBLIC)));
      return;
    }
    if (
      finished ||
      !matches(request.headers.authorization, `Bearer ${tokens.host}`)
    ) {
      response.writeHead(403).end();
      return;
    }
    if (url.pathname === "/manifest") {
      response
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(manifest));
      return;
    }
    const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? "");
    const start = Number(match?.[1]);
    const end = Number(match?.[2]);
    if (
      url.pathname !== "/media" ||
      !match ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end >= manifest.size ||
      end - start + 1 > CHUNK_BYTES
    ) {
      response.writeHead(416).end();
      return;
    }
    const file = await open(mediaPath, "r");
    try {
      const data = Buffer.alloc(end - start + 1);
      const { bytesRead } = await file.read(data, 0, data.length, start);
      if (bytesRead !== data.length) throw new Error("short read");
      response
        .writeHead(206, {
          "Content-Type": "application/octet-stream",
          "Content-Length": data.length,
          "Content-Range": `bytes ${start}-${end}/${manifest.size}`,
        })
        .end(data);
    } finally {
      await file.close();
    }
  }
  server.on("upgrade", (request, socket, head) => {
    if (
      finished ||
      request.url !== "/signal" ||
      wss.clients.size >= 4 ||
      request.headers.host !== new URL(origin).host ||
      request.headers.origin !== origin
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(request, socket, head, (peer) =>
      wss.emit("connection", peer),
    );
  });
  wss.on("connection", (peer) => {
    let role;
    let relayed = false;
    const authTimer = setTimeout(() => peer.close(1008, "auth timeout"), 3_000);
    peer.on("error", () => {});
    peer.on("message", (data, binary) => {
      let message;
      try {
        if (binary) throw new Error();
        message = JSON.parse(data.toString());
        if (!message || typeof message !== "object" || Array.isArray(message))
          throw new Error();
      } catch {
        peer.close(1008);
        return;
      }
      if (!role) {
        if (
          message.type !== "auth" ||
          !["host", "guest"].includes(message.role) ||
          !matches(message.key, tokens[message.role]) ||
          peers.has(message.role)
        ) {
          peer.close(1008);
          return;
        }
        role = message.role;
        peers.set(role, peer);
        clearTimeout(authTimer);
        if (peers.size === 2)
          for (const item of peers.values())
            item.send(JSON.stringify({ type: "paired" }));
        return;
      }
      const expected = role === "host" ? "offer" : "answer";
      const other = peers.get(role === "host" ? "guest" : "host");
      if (
        relayed ||
        message.type !== "sdp" ||
        message.description?.type !== expected ||
        typeof message.description.sdp !== "string" ||
        message.description.sdp.length > 60_000 ||
        other?.readyState !== WebSocket.OPEN
      ) {
        peer.close(1008);
        return;
      }
      relayed = true;
      other.send(JSON.stringify(message));
    });
    peer.on("close", () => {
      clearTimeout(authTimer);
      if (role) finish();
    });
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolveListen);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  const timer = setTimeout(finish, lifetimeMs);
  return {
    origin,
    hostUrl: `${origin}/#role=host&key=${tokens.host}`,
    guestUrl: `${origin}/#role=guest&key=${tokens.guest}`,
    async stop() {
      clearTimeout(timer);
      finish();
      wss.close();
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    },
  };
}

async function main() {
  const args = process.argv
    .slice(2)
    .filter((value, index) => !(index === 0 && value === "--"));
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = {
      "--input": "input",
      "--ffmpeg": "ffmpeg",
      "--ffprobe": "ffprobe",
    }[args[index]];
    if (!key || !args[index + 1] || options[key])
      throw new Error(
        "Использование: pnpm segment:poc -- --input <movie> [--ffmpeg <binary>] [--ffprobe <binary>]",
      );
    options[key] = args[index + 1];
  }
  if (!options.input) throw new Error("Укажите --input с H.264/AAC файлом.");
  const prepared = await prepareMovie(options);
  let session;
  try {
    session = await startPoc(prepared);
  } catch (error) {
    await prepared.dispose();
    throw error;
  }
  console.log(
    "Только локальный PoC, не Internet-комната. Откройте ссылки в двух окнах Chrome/Edge.",
  );
  console.log(
    `Подготовка: stream-copy, ${prepared.preparation.elapsedMs} мс, ${prepared.preparation.sizeBytes} байт.`,
  );
  console.log(`Host: ${session.hostUrl}\nGuest: ${session.guestUrl}`);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await session.stop();
    await prepared.dispose();
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    console.error(
      "PoC не запущен. Проверьте инструменты и совместимость H.264/AAC-LC; пути и media stderr скрыты.",
    );
    process.exitCode = 1;
  });
}
