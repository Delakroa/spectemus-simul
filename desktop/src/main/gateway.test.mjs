import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { startGateway } from "./gateway.mjs";

test("раздаёт SPA и сохраняет Host/Cookie при API proxy", async (t) => {
  let receivedHost;
  let receivedCookie;
  let receivedForwardedFor;
  const backend = createServer((request, response) => {
    receivedHost = request.headers.host;
    receivedCookie = request.headers.cookie;
    receivedForwardedFor = request.headers["x-forwarded-for"];
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
  const gatewayPort = gateway.port;
  t.after(() => gateway.close());

  const page = await get(gatewayPort, "/rooms/AbCdEfGhIjKlMnOpQrStUv", {
    Accept: "text/html",
  });
  assert.equal(page.statusCode, 200);
  assert.equal(page.body, "<main>S²</main>");

  const api = await get(gatewayPort, "/api/v1/health", {
    Cookie: "spectemus-simul-session=secret",
    Host: "192.168.1.42:8088",
    "X-Forwarded-For": "203.0.113.9",
  });
  assert.equal(api.statusCode, 200);
  assert.equal(receivedHost, "192.168.1.42:8088");
  assert.equal(receivedCookie, "spectemus-simul-session=secret");
  assert.equal(receivedForwardedFor, "127.0.0.1");
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
  const gatewayPort = gateway.port;
  t.after(() => gateway.close());

  const response = await websocketUpgrade(gatewayPort);
  assert.match(response, /101 Switching Protocols/);
  assert.equal(receivedCookie, "spectemus-simul-session=secret");
});

test("не дописывает HTTP-ошибку в уже открытый WebSocket", async (t) => {
  const backend = createServer();
  backend.on("upgrade", (_request, socket) => {
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
    );
    setImmediate(() => socket.resetAndDestroy());
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
  t.after(() => gateway.close());

  const response = await websocketUpgradeUntilClose(gateway.port);

  assert.match(response, /^HTTP\/1\.1 101 Switching Protocols/m);
  assert.doesNotMatch(response, /HTTP\/1\.1 502 Bad Gateway/);
});

test("обрывает backend response, когда HTTP-клиент gateway отключился", async (t) => {
  let backendResponseClosed = false;
  const backend = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/octet-stream" });
    response.write("first chunk");
    const interval = setInterval(() => response.write("next chunk"), 5);
    response.once("close", () => {
      clearInterval(interval);
      backendResponseClosed = true;
    });
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
  t.after(() => gateway.close());

  await abortRequest(gateway.port, "/api/v1/slow-response");
  await waitFor(() => backendResponseClosed);
  assert.equal(backendResponseClosed, true);
});

test("раздаёт выбранный host-ом media file только через loopback и поддерживает Range", async (t) => {
  const frontendDirectory = await mkdtemp(join(tmpdir(), "spectemus-gateway-"));
  const movie = join(frontendDirectory, "prepared.mp4");
  await writeFile(join(frontendDirectory, "index.html"), "ok");
  await writeFile(movie, "0123456789");
  const mediaId = "d77b031d-e42c-452b-8749-b90560e63c42";
  const gateway = await startGateway({
    frontendDirectory,
    host: "127.0.0.1",
    mediaResolver: (id) =>
      id === mediaId ? { displayName: "prepared.mp4", filePath: movie } : null,
    port: 0,
  });
  t.after(() => gateway.close());

  const response = await get(gateway.port, `/_desktop/media/${mediaId}`, {
    Range: "bytes=2-5",
  });

  assert.equal(response.statusCode, 206);
  assert.equal(response.body, "2345");
  assert.equal(response.headers["content-type"], "video/mp4");
  assert.equal(response.headers["content-range"], "bytes 2-5/10");
});

test("не раздаёт desktop media без loopback resolver", async (t) => {
  const frontendDirectory = await mkdtemp(join(tmpdir(), "spectemus-gateway-"));
  await writeFile(join(frontendDirectory, "index.html"), "ok");
  const gateway = await startGateway({
    frontendDirectory,
    host: "127.0.0.1",
    port: 0,
  });
  t.after(() => gateway.close());

  const response = await get(
    gateway.port,
    "/_desktop/media/d77b031d-e42c-452b-8749-b90560e63c42",
  );

  assert.equal(response.statusCode, 404);
});

test("не падает на некорректном HTTP или WebSocket request target", async (t) => {
  const frontendDirectory = await mkdtemp(join(tmpdir(), "spectemus-gateway-"));
  await writeFile(join(frontendDirectory, "index.html"), "ok");
  const gateway = await startGateway({
    frontendDirectory,
    host: "127.0.0.1",
    port: 0,
  });
  t.after(() => gateway.close());

  const httpResponse = await rawRequest(
    gateway.port,
    "GET //[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
  );
  assert.match(httpResponse, /^HTTP\/1\.1 400 Bad Request/m);

  const upgradeResponse = await rawRequest(
    gateway.port,
    "GET //[ HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
  );
  assert.match(upgradeResponse, /^HTTP\/1\.1 400 Bad Request/m);

  const health = await get(gateway.port, "/gateway-health");
  assert.equal(health.statusCode, 200);
});

test("отдаёт пустой media file без createReadStream ошибки", async (t) => {
  const frontendDirectory = await mkdtemp(join(tmpdir(), "spectemus-gateway-"));
  const movie = join(frontendDirectory, "empty.mp4");
  const mediaId = "ec35bc3d-83be-429a-b603-df99cd0c5127";
  await writeFile(join(frontendDirectory, "index.html"), "ok");
  await writeFile(movie, "");
  const gateway = await startGateway({
    frontendDirectory,
    host: "127.0.0.1",
    mediaResolver: (id) =>
      id === mediaId ? { displayName: "empty.mp4", filePath: movie } : null,
    port: 0,
  });
  t.after(() => gateway.close());

  const response = await get(gateway.port, `/_desktop/media/${mediaId}`);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "");
  assert.equal(response.headers["content-length"], "0");

  const ranged = await get(gateway.port, `/_desktop/media/${mediaId}`, {
    Range: "bytes=0-0",
  });
  assert.equal(ranged.statusCode, 416);
  assert.equal(ranged.headers["content-range"], "bytes */0");
});

test("уничтожает source stream после обрыва media request клиентом", async (t) => {
  const frontendDirectory = await mkdtemp(join(tmpdir(), "spectemus-gateway-"));
  const movie = join(frontendDirectory, "prepared.mp4");
  const mediaId = "0cce6f77-438d-4253-b3c8-13d45e5c93e9";
  let source;
  await writeFile(join(frontendDirectory, "index.html"), "ok");
  await writeFile(movie, "not-empty");
  const gateway = await startGateway({
    createMediaReadStream: () => {
      source = new Readable({
        read() {
          setImmediate(() => this.push(Buffer.alloc(16 * 1024)));
        },
      });
      return source;
    },
    frontendDirectory,
    host: "127.0.0.1",
    mediaResolver: (id) =>
      id === mediaId ? { displayName: "prepared.mp4", filePath: movie } : null,
    port: 0,
  });
  t.after(() => gateway.close());

  await abortRequest(gateway.port, `/_desktop/media/${mediaId}`);
  await waitFor(() => source?.destroyed === true);
  assert.equal(source?.destroyed, true);
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
          resolve({
            body,
            headers: response.headers,
            statusCode: response.statusCode,
          }),
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
        "GET /api/v1/rooms/AbCdEfGhIjKlMnOpQrStUv/events HTTP/1.1\r\nHost: 192.168.1.42:8088\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nCookie: spectemus-simul-session=secret\r\n\r\n",
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

function websocketUpgradeUntilClose(port) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let response = "";
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve(response);
      }
    };
    socket.once("connect", () => {
      socket.write(
        "GET /api/v1/rooms/AbCdEfGhIjKlMnOpQrStUv/events HTTP/1.1\r\nHost: 192.168.1.42:8088\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nCookie: spectemus-simul-session=secret\r\n\r\n",
      );
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
    });
    socket.once("close", finish);
    socket.once("error", finish);
    setTimeout(() => {
      socket.destroy();
      reject(
        new Error(
          "WebSocket gateway не закрыл соединение после backend failure.",
        ),
      );
    }, 1_000).unref();
  });
}

function rawRequest(port, request) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let response = "";
    socket.once("connect", () => socket.end(request));
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
    });
    socket.once("close", () => resolve(response));
    socket.once("error", reject);
  });
}

function abortRequest(port, path) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n`,
      );
    });
    socket.once("data", () => {
      socket.destroy();
      resolve();
    });
    socket.once("error", reject);
  });
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
  }
  throw new Error("Ожидаемое состояние gateway не наступило.");
}
