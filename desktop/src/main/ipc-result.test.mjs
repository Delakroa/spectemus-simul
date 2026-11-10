import assert from "node:assert/strict";
import test from "node:test";

import {
  isIpcProblem,
  runAsIpcResult,
  toIpcFailure,
  toIpcSuccess,
} from "./ipc-result.mjs";

test("runAsIpcResult keeps 401/404/429 fields through structured clone", async () => {
  const cases = [
    {
      code: "ACCOUNT_REQUIRED",
      status: 401,
      title: "Нужен вход",
      retryable: false,
    },
    {
      code: "MEMBERSHIP_REQUIRED",
      status: 404,
      title: "Комната недоступна",
      retryable: false,
    },
    {
      code: "RATE_LIMITED",
      status: 429,
      title: "Слишком много попыток",
      retryable: true,
    },
  ];

  for (const item of cases) {
    const problem = { name: "ApiProblemError", ...item };
    assert.equal(isIpcProblem(problem), true);
    const envelope = await runAsIpcResult(async () => {
      throw problem;
    });
    // Electron invoke/contextBridge clone resolved values; rejected Errors lose fields.
    const cloned = structuredClone(envelope);
    assert.equal(cloned.ok, false);
    assert.equal(cloned.problem.code, item.code);
    assert.equal(cloned.problem.status, item.status);
    assert.equal(cloned.problem.title, item.title);
    assert.equal(cloned.problem.retryable, item.retryable);
    assert.equal(Object.hasOwn(cloned.problem, "deviceCredential"), false);
  }
});

test("runAsIpcResult wraps successful mint data without leaking secrets", async () => {
  const data = {
    token: "header.payload.signature-value",
    liveKitUrl: "wss://rtc.example.test",
    role: "HOST",
  };
  const envelope = structuredClone(await runAsIpcResult(async () => data));
  assert.deepEqual(envelope, toIpcSuccess(data));
  assert.equal(Object.hasOwn(envelope.data, "deviceCredential"), false);
});

test("toIpcFailure maps plain Error without inventing success", () => {
  const failure = toIpcFailure(new Error("publicRoomId must be a UUID"));
  assert.equal(failure.ok, false);
  assert.equal(failure.problem.status, 500);
  assert.equal(failure.problem.title, "publicRoomId must be a UUID");
  assert.equal(failure.problem.retryable, true);
});
