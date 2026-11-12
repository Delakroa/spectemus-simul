import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import SwaggerParser from "@apidevtools/swagger-parser";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const contractsRoot = path.join(repoRoot, "contracts");

async function readJson(relativePath) {
  return JSON.parse(
    await readFile(path.join(contractsRoot, relativePath), "utf8"),
  );
}

function assertValid(validate, value, label) {
  if (!validate(value)) {
    throw new Error(`${label}: ${JSON.stringify(validate.errors, null, 2)}`);
  }
}

const openApi = await SwaggerParser.validate(
  path.join(contractsRoot, "openapi.yaml"),
);
console.log("[ok] OpenAPI contract");

const publicInviteSchema = openApi.components.schemas.PublicInviteCreated;
const redeemInviteSchema = openApi.components.schemas.RedeemPublicInviteRequest;
assert.equal(
  openApi.components.securitySchemes.accountSessionCookie.name,
  "wt_account",
  "Planned Internet mode must keep account and LAN room cookies separate",
);
const publicLiveKitToken =
  openApi.paths["/api/v2/public-rooms/{publicRoomId}/livekit-token"].post;
const publicConnectionTelemetry =
  openApi.paths["/api/v2/public-rooms/{publicRoomId}/connection-telemetry"]
    .post;
assert.deepEqual(
  publicConnectionTelemetry.security,
  [{ accountSessionCookie: [] }, { deviceSessionBearer: [] }],
  "Internet telemetry must require an account cookie or device Bearer",
);
assert.equal(
  publicConnectionTelemetry["x-implementation-status"],
  "implemented",
);
assert.equal(
  publicLiveKitToken["x-implementation-status"],
  "implemented",
  "Public LiveKit token must be marked implemented after SPS-720",
);
assert.deepEqual(
  publicLiveKitToken.security,
  [{ accountSessionCookie: [] }, { deviceSessionBearer: [] }],
  "Public LiveKit token must accept account cookie or desktop device Bearer",
);
assert.equal(
  openApi.components.securitySchemes.deviceSessionBearer?.scheme,
  "bearer",
  "Desktop device sessions must use HTTP Bearer, not a cookie on loopback",
);
const publicTokenSchema =
  publicLiveKitToken.responses["200"].content["application/json"].schema;
assert.equal(
  publicTokenSchema.properties.roomName.pattern,
  "^[A-Za-z0-9_-]{43}$",
  "Public LiveKit token must use opaque roomName, not LAN RoomId",
);
assert.equal(
  publicTokenSchema.properties.liveKitUrl.pattern,
  "^wss://",
  "Public LiveKit token must require an explicit wss:// browser URL",
);
assert.equal(
  openApi.components.schemas.LiveKitTokenResponse.properties.roomName.pattern,
  "^[A-Za-z0-9_-]{22}$",
  "LAN LiveKitTokenResponse.roomName must stay bound to RoomId",
);
assert.notEqual(
  openApi.components.schemas.LiveKitTokenResponse.properties.roomName.pattern,
  publicTokenSchema.properties.roomName.pattern,
  "Public response must not weaken or reuse the LAN RoomId contract",
);
assert.deepEqual(
  Object.keys(openApi.components.schemas.CreateRoomRequest.properties),
  ["hostDisplayName"],
  "LAN create must stay free of an Internet mode field",
);
assert.equal(
  JSON.stringify(publicLiveKitToken).includes("inviteToken"),
  false,
  "Public LiveKit token contract must not expose inviteToken",
);
assert.equal(
  publicInviteSchema.properties.invitePath.pattern,
  "^/join#invite=[A-Za-z0-9_-]{43}$",
  "Raw invite token must stay in the browser-only URL fragment",
);
assert.equal(
  redeemInviteSchema.properties.inviteToken.writeOnly,
  true,
  "Invite token must be write-only in the redemption request",
);
for (const pathItem of Object.values(openApi.paths)) {
  const parameters = [
    ...(pathItem.parameters ?? []),
    ...Object.values(pathItem).flatMap(
      (operation) => operation.parameters ?? [],
    ),
  ];
  assert.equal(
    parameters.some(
      (parameter) =>
        parameter.name === "inviteToken" &&
        (parameter.in === "path" || parameter.in === "query"),
    ),
    false,
    "Invite token must never appear in an API path or query parameter",
  );
}
const deviceBindingStart = openApi.paths["/api/v2/auth/device-bindings"].post;
assert.equal(
  deviceBindingStart["x-implementation-status"],
  "implemented",
  "Device binding start must be marked implemented after SPS-724",
);
assert.equal(
  openApi.paths["/api/v2/auth/device-bindings/{bindingId}/approve"].post
    .security?.[0]?.accountSessionCookie !== undefined,
  true,
  "Device binding approve must require the account session cookie",
);
assert.equal(
  openApi.components.schemas.ExchangeDeviceBindingRequest.properties.deviceCode
    .writeOnly,
  true,
  "deviceCode must stay write-only in the exchange request",
);
assert.equal(
  openApi.components.schemas.DeviceBindingSession.properties.deviceCredential
    .writeOnly,
  true,
  "deviceCredential must stay write-only in the session response schema",
);
for (const [pathKey, pathItem] of Object.entries(openApi.paths)) {
  if (
    !pathKey.includes("device-binding") &&
    !pathKey.includes("device-sessions")
  ) {
    continue;
  }
  for (const operation of Object.values(pathItem)) {
    if (
      !operation ||
      typeof operation !== "object" ||
      !("parameters" in operation)
    ) {
      continue;
    }
    const parameters = operation.parameters ?? [];
    assert.equal(
      parameters.some(
        (parameter) =>
          ["deviceCode", "deviceCredential", "userCode"].includes(
            parameter.name,
          ) &&
          (parameter.in === "query" || parameter.in === "path"),
      ),
      false,
      `${pathKey} must not place device secrets in path or query`,
    );
  }
}
assert.equal(
  Object.keys(openApi.paths).some(
    (pathKey) => pathKey.startsWith("/api/v1") && pathKey.includes("device"),
  ),
  false,
  "LAN /api/v1 must stay free of device-binding routes",
);
console.log("[ok] Internet access contract privacy invariants");

const [commonSchema, problemSchema, clientEventSchema, serverEventSchema] =
  await Promise.all([
    readJson("schemas/common.schema.json"),
    readJson("schemas/problem-details.schema.json"),
    readJson("schemas/websocket-client-event.schema.json"),
    readJson("schemas/websocket-server-event.schema.json"),
  ]);

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictTypes: false,
});
addFormats(ajv);
ajv.addSchema(commonSchema);
ajv.addSchema(problemSchema);

const validateProblem = ajv.compile(problemSchema);
const validateClientEvent = ajv.compile(clientEventSchema);
const validateServerEvent = ajv.compile(serverEventSchema);
const validatePublicConnectionTelemetry = ajv.compile(
  openApi.components.schemas.PublicConnectionTelemetryRequest,
);
assertValid(
  validatePublicConnectionTelemetry,
  { type: "RECONNECTING" },
  "Internet connection telemetry event",
);
for (const invalid of [
  {},
  { type: "UNKNOWN" },
  { type: "CONNECTED", roomId: "should-not-be-here" },
  { type: "CONNECTED", detail: "free text" },
]) {
  assert.equal(
    validatePublicConnectionTelemetry(invalid),
    false,
    "Internet telemetry contract must reject identifiers and free text",
  );
}

const [
  problemExample,
  heartbeatExample,
  chatMessageClientExample,
  snapshotExample,
  participantJoinedExample,
  participantOnlineExample,
  participantOfflineExample,
  participantLeftExample,
  roomClosedExample,
  chatMessageServerExample,
  hostDisconnectedExample,
  hostReconnectedExample,
  errorExample,
  unknownServerEvent,
] = await Promise.all([
  readJson("examples/problem-details.json"),
  readJson("examples/client/participant-heartbeat.json"),
  readJson("examples/client/chat-message.json"),
  readJson("examples/server/room-snapshot.json"),
  readJson("examples/server/participant-joined.json"),
  readJson("examples/server/participant-online.json"),
  readJson("examples/server/participant-offline.json"),
  readJson("examples/server/participant-left.json"),
  readJson("examples/server/room-closed.json"),
  readJson("examples/server/chat-message.json"),
  readJson("examples/server/host-disconnected.json"),
  readJson("examples/server/host-reconnected.json"),
  readJson("examples/server/error.json"),
  readJson("examples/server/unknown-event.json"),
]);

assertValid(validateProblem, problemExample, "Problem Details example");
assertValid(validateClientEvent, heartbeatExample, "Client event example");
assertValid(
  validateClientEvent,
  chatMessageClientExample,
  "Client chat message example",
);
assertValid(validateServerEvent, snapshotExample, "Server snapshot example");
assertValid(
  validateServerEvent,
  participantJoinedExample,
  "Server participant joined example",
);
assertValid(
  validateServerEvent,
  participantOnlineExample,
  "Server participant online example",
);
assertValid(
  validateServerEvent,
  participantOfflineExample,
  "Server participant offline example",
);
assertValid(
  validateServerEvent,
  participantLeftExample,
  "Server participant left example",
);
assertValid(
  validateServerEvent,
  roomClosedExample,
  "Server room closed example",
);
assertValid(
  validateServerEvent,
  chatMessageServerExample,
  "Server chat message example",
);
assertValid(
  validateServerEvent,
  hostDisconnectedExample,
  "Server host disconnected example",
);
assertValid(
  validateServerEvent,
  hostReconnectedExample,
  "Server host reconnected example",
);
assertValid(validateServerEvent, errorExample, "Server error example");
assertValid(
  validateServerEvent,
  unknownServerEvent,
  "Unknown server event example",
);

const unknownClientEvent = structuredClone(heartbeatExample);
unknownClientEvent.type = "participant.future.command";
assert.equal(
  validateClientEvent(unknownClientEvent),
  false,
  "Unknown client command must be rejected",
);

const invalidSnapshot = structuredClone(snapshotExample);
invalidSnapshot.payload = {};
assert.equal(
  validateServerEvent(invalidSnapshot),
  false,
  "Known server event with invalid payload must be rejected",
);

console.log("[ok] Problem Details schema and example");
console.log("[ok] WebSocket client event schema and example");
console.log("[ok] WebSocket server event schemas and examples");
console.log("[ok] Forward compatibility and invalid payload checks");
