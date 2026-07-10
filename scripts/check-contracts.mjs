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

await SwaggerParser.validate(path.join(contractsRoot, "openapi.yaml"));
console.log("[ok] OpenAPI contract");

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
