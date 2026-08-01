import assert from "node:assert/strict";
import test from "node:test";

import { createShutdownCoordinator } from "./shutdown.mjs";

test("повторный выход не прерывает очистку desktop host", async () => {
  const stopSupervisor = createDeferred();
  const clearMedia = createDeferred();
  let quitCalls = 0;
  const coordinator = createShutdownCoordinator({
    clearMedia: clearMedia.run,
    quit: () => {
      quitCalls += 1;
    },
    stopSupervisor: stopSupervisor.run,
  });
  const firstQuit = createQuitEvent();
  const secondQuit = createQuitEvent();

  coordinator.handleBeforeQuit(firstQuit);
  coordinator.handleBeforeQuit(secondQuit);

  assert.equal(firstQuit.prevented, true);
  assert.equal(secondQuit.prevented, true);
  assert.equal(stopSupervisor.calls, 1);
  assert.equal(clearMedia.calls, 1);
  assert.equal(quitCalls, 0);

  stopSupervisor.resolve();
  clearMedia.resolve();
  await coordinator.whenFinished();

  assert.equal(quitCalls, 1);
  const finalQuit = createQuitEvent();
  coordinator.handleBeforeQuit(finalQuit);
  assert.equal(finalQuit.prevented, false);
});

function createQuitEvent() {
  return {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
}

function createDeferred() {
  let resolvePromise;
  let calls = 0;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return {
    get calls() {
      return calls;
    },
    resolve: resolvePromise,
    run: () => {
      calls += 1;
      return promise;
    },
  };
}
