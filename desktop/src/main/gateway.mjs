import {
  createServer as createHttpServer,
  request as requestHttp,
} from "node:http";
import { connect } from "node:net";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
const MEDIA_CONTENT_TYPES = {
  ".avi": "video/x-msvideo",
  ".flv": "video/x-flv",
  ".m4v": "video/mp4",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".m2ts": "video/mp2t",
  ".ts": "video/mp2t",
  ".webm": "video/webm",
  ".wmv": "video/x-ms-wmv",
};
const UPSTREAM_TIMEOUT_MS = 15_000;

export async function startGateway({
  backend = { host: "127.0.0.1", port: 8080 },
  frontendDirectory,
  host = "0.0.0.0",
  mediaResolver,
  port = 8088,
}) {
  const server = createGatewayServer({
    backend,
    frontendDirectory,
    mediaResolver,
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, host, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server, server.spectemusSockets);
    throw new Error("Gateway не вернул TCP-порт после запуска.");
  }

  return {
    close: () => closeServer(server, server.spectemusSockets),
    port: address.port,
    server,
  };
}

export function createGatewayServer({
  backend,
  frontendDirectory,
  mediaResolver,
}) {
  const root = resolve(frontendDirectory);
  const sockets = new Set();
  const server = createHttpServer((request, response) => {
    void handleRequest({ backend, mediaResolver, request, response, root });
  });
  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://gateway.local")
      .pathname;
    if (!pathname.startsWith("/api/")) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    proxyUpgrade({ backend, request, socket, head });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.spectemusSockets = sockets;
  return server;
}

async function handleRequest({
  backend,
  mediaResolver,
  request,
  response,
  root,
}) {
  const url = new URL(request.url ?? "/", "http://gateway.local");
  if (url.pathname === "/gateway-health") {
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    });
    response.end('{"status":"UP"}');
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    proxyHttp({ backend, request, response });
    return;
  }
  const mediaId = mediaIdFromPath(url.pathname);
  if (mediaId) {
    await serveDesktopMedia({ mediaId, mediaResolver, request, response });
    return;
  }
  await serveFrontend({ request, response, root, pathname: url.pathname });
}

async function serveDesktopMedia({
  mediaId,
  mediaResolver,
  request,
  response,
}) {
  if (!isLoopbackRequest(request) || !mediaResolver) {
    response.writeHead(404, { "Cache-Control": "no-store" });
    response.end();
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }
  const media = mediaResolver(mediaId);
  if (!media) {
    response.writeHead(404, { "Cache-Control": "no-store" });
    response.end();
    return;
  }

  let mediaStats;
  try {
    mediaStats = await stat(media.filePath);
  } catch {
    response.writeHead(404, { "Cache-Control": "no-store" });
    response.end();
    return;
  }
  if (!mediaStats.isFile()) {
    response.writeHead(404, { "Cache-Control": "no-store" });
    response.end();
    return;
  }

  const range = parseRange(request.headers.range, mediaStats.size);
  if (range === "invalid") {
    response.writeHead(416, {
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "Content-Range": `bytes */${mediaStats.size}`,
    });
    response.end();
    return;
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? mediaStats.size - 1;
  const headers = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Length": String(end - start + 1),
    "Content-Type": mediaContentType(media.displayName),
  };
  if (range) {
    headers["Content-Range"] = `bytes ${start}-${end}/${mediaStats.size}`;
  }
  response.writeHead(range ? 206 : 200, headers);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  const stream = createReadStream(media.filePath, { end, start });
  stream.once("error", () => response.destroy());
  stream.pipe(response);
}

function proxyHttp({ backend, request, response }) {
  const upstream = requestHttp(
    {
      host: backend.host,
      port: backend.port,
      method: request.method,
      path: request.url,
      headers: trustedForwardHeaders(request),
      timeout: UPSTREAM_TIMEOUT_MS,
    },
    (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.headers,
      );
      upstreamResponse.pipe(response);
    },
  );
  upstream.once("timeout", () => {
    upstream.destroy(new Error("Backend timeout"));
  });
  upstream.once("error", () => {
    if (!response.headersSent) {
      response.writeHead(502, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end('{"code":"BACKEND_UNAVAILABLE"}');
      return;
    }
    response.destroy();
  });
  request.pipe(upstream);
}

function proxyUpgrade({ backend, request, socket, head }) {
  const upstream = connect(backend.port, backend.host);
  const fail = () => {
    if (!socket.destroyed) {
      socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    }
  };
  upstream.once("error", fail);
  socket.once("error", () => upstream.destroy());
  socket.once("close", () => upstream.destroy());
  upstream.once("close", () => socket.destroy());
  upstream.once("connect", () => {
    const headLines = [
      `${request.method} ${request.url} HTTP/${request.httpVersion}`,
    ];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      if (request.rawHeaders[index].toLowerCase() === "x-forwarded-for") {
        continue;
      }
      headLines.push(
        `${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}`,
      );
    }
    headLines.push(`X-Forwarded-For: ${clientAddress(request)}`);
    upstream.write(`${headLines.join("\r\n")}\r\n\r\n`);
    if (head.length > 0) {
      upstream.write(head);
    }
    socket.pipe(upstream).pipe(socket);
  });
}

function trustedForwardHeaders(request) {
  const headers = { ...request.headers };
  delete headers["x-forwarded-for"];
  headers["x-forwarded-for"] = clientAddress(request);
  return headers;
}

function clientAddress(request) {
  return request.socket.remoteAddress ?? "unknown";
}

async function serveFrontend({ request, response, root, pathname }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }
  const requested = safeAssetPath(
    root,
    pathname === "/" ? "/index.html" : pathname,
  );
  const asset = requested ? await readAsset(requested) : null;
  if (asset) {
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      "Content-Type": contentType(requested),
    });
    response.end(request.method === "HEAD" ? undefined : asset);
    return;
  }
  if (acceptsHtml(request) && !extname(pathname)) {
    const indexPath = resolve(root, "index.html");
    const index = await readAsset(indexPath);
    if (index) {
      response.writeHead(200, {
        "Cache-Control": "no-cache",
        "Content-Type": contentType(indexPath),
      });
      response.end(request.method === "HEAD" ? undefined : index);
      return;
    }
  }
  response.writeHead(404, { "Cache-Control": "no-store" });
  response.end();
}

function safeAssetPath(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) {
    return null;
  }
  const candidate = resolve(root, `.${decoded}`);
  return candidate === root || candidate.startsWith(`${root}${sep}`)
    ? candidate
    : null;
}

async function readAsset(filePath) {
  try {
    if (!(await stat(filePath)).isFile()) {
      return null;
    }
    return await readFile(filePath);
  } catch {
    return null;
  }
}

function contentType(filePath) {
  return (
    CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream"
  );
}

function acceptsHtml(request) {
  return request.headers.accept?.includes("text/html") ?? false;
}

function mediaIdFromPath(pathname) {
  const match = /^\/_desktop\/media\/([0-9a-f-]{36})$/i.exec(pathname);
  return match?.[1] ?? null;
}

function isLoopbackRequest(request) {
  const address = request.socket.remoteAddress;
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

function mediaContentType(displayName) {
  return (
    MEDIA_CONTENT_TYPES[extname(displayName).toLowerCase()] ??
    "application/octet-stream"
  );
}

function parseRange(header, size) {
  if (!header) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match) {
    return "invalid";
  }
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) {
    return "invalid";
  }
  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return "invalid";
    }
    return { end: size - 1, start: Math.max(0, size - suffixLength) };
  }
  const start = Number(rawStart);
  const end = rawEnd ? Number(rawEnd) : size - 1;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return "invalid";
  }
  return { end: Math.min(end, size - 1), start };
}

function closeServer(server, sockets = new Set()) {
  return new Promise((resolveClose, rejectClose) => {
    for (const socket of sockets) {
      socket.destroy();
    }
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}
