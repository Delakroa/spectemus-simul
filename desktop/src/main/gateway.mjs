import {
  createServer as createHttpServer,
  request as requestHttp,
} from "node:http";
import { connect } from "node:net";
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

export async function startGateway({
  backend = { host: "127.0.0.1", port: 8080 },
  frontendDirectory,
  host = "0.0.0.0",
  port = 8088,
}) {
  const server = createGatewayServer({ backend, frontendDirectory });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, host, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  return {
    close: () => closeServer(server, server.spectemusSockets),
    server,
  };
}

export function createGatewayServer({ backend, frontendDirectory }) {
  const root = resolve(frontendDirectory);
  const sockets = new Set();
  const server = createHttpServer((request, response) => {
    void handleRequest({ backend, request, response, root });
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

async function handleRequest({ backend, request, response, root }) {
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
  await serveFrontend({ request, response, root, pathname: url.pathname });
}

function proxyHttp({ backend, request, response }) {
  const upstream = requestHttp(
    {
      host: backend.host,
      port: backend.port,
      method: request.method,
      path: request.url,
      headers: request.headers,
    },
    (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.headers,
      );
      upstreamResponse.pipe(response);
    },
  );
  upstream.once("error", () => {
    if (!response.headersSent) {
      response.writeHead(502, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
    }
    response.end('{"code":"BACKEND_UNAVAILABLE"}');
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
      headLines.push(
        `${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}`,
      );
    }
    upstream.write(`${headLines.join("\r\n")}\r\n\r\n`);
    if (head.length > 0) {
      upstream.write(head);
    }
    socket.pipe(upstream).pipe(socket);
  });
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

function closeServer(server, sockets = new Set()) {
  return new Promise((resolveClose, rejectClose) => {
    for (const socket of sockets) {
      socket.destroy();
    }
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}
