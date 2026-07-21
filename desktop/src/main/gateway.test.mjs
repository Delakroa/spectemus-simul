import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startGateway } from "./gateway.mjs";

test("раздаёт SPA и сохраняет Host/Cookie при API proxy", async (t) => {
  let receivedHost;
  let receivedCookie;
  const backend = createServer((request, response) => {
    receivedHost = request.headers.host;
    receivedCookie = request.headers.cookie;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end('{"ok":true}');
  });
  const backendPort = await listen(backend);
  t.after(() => close(backend));

  const frontendDirectory = await mkdtemp(join(tmpdir(), "spectemus-gateway-"));
  await writeFile(join(frontendDirectory, "index.html"), "<main>S²</main>");
  const gateway = await startGateway({
    backend: { host: "127.0.0.1", port: backendPort },
    frontendDirectory,
    host: "127.0.0.1",
    port: 0,
  });
  const gatewayPort = gateway.server.address().port;
  t.after(() => gateway.close());

  const page = await get(gatewayPort, "/rooms/AbCdEfGhIjKlMnOpQrStUv", {
    Accept: "text/html",
  });
  assert.equal(page.statusCode, 200);
  assert.equal(page.body, "<main>S²</main>");

  const api = await get(gatewayPort, "/api/v1/health", {
    Cookie: "watch-together-session=secret",
    Host: "192.168.1.42:8088",
  });
  assert.equal(api.statusCode, 200);
  assert.equal(receivedHost, "192.168.1.42:8088");
  assert.equal(receivedCookie, "watch-together-session=secret");
});

test("проксирует WebSocket upgrade только в локальный backend", async (t) => {
  let receivedCookie;
  const backend = createServer();
  backend.on("upgrade", (request, socket) => {
    receivedCookie = request.headers.cookie;
    socket.end(
      "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
    );
  });
  const backendPort = await listen(backend);
  t.after(() => close(backend));

  const frontendDirectory = await mkdtemp(join(tmpdir(), "spectemus-gateway-"));
  await writeFile(join(frontendDirectory, "index.html"), "ok");
  const gateway = await startGateway({
    backend: { host: "127.0.0.1", port: backendPort },
    frontendDirectory,
    host: "127.0.0.1",
    port: 0,
  });
  const gatewayPort = gateway.server.address().port;
  t.after(() => gateway.close());

  const response = await websocketUpgrade(gatewayPort);
  assert.match(response, /101 Switching Protocols/);
  assert.equal(receivedCookie, "watch-together-session=secret");
});

function listen(server) {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server.address().port)),
  );
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function get(port, path, headers) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: "127.0.0.1", port, path, headers },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () =>
          resolve({ body, statusCode: response.statusCode }),
        );
      },
    );
    request.once("error", reject);
    request.end();
  });
}

function websocketUpgrade(port) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let response = "";
    socket.once("connect", () => {
      socket.write(
        "GET /api/v1/rooms/AbCdEfGhIjKlMnOpQrStUv/events HTTP/1.1\r\nHost: 192.168.1.42:8088\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nCookie: watch-together-session=secret\r\n\r\n",
      );
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (response.includes("\r\n\r\n")) {
        socket.destroy();
        resolve(response);
      }
    });
    socket.once("error", reject);
  });
}
