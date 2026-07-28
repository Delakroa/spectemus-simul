import assert from "node:assert/strict";
import test from "node:test";

import { acquireDesktopInstanceLock } from "./instance-lock.mjs";

test("разрешает primary instance и передаёт повторный запуск обработчику", () => {
  const handlers = new Map();
  const app = {
    on(event, listener) {
      handlers.set(event, listener);
    },
    quit() {
      throw new Error("primary instance не должен завершаться");
    },
    requestSingleInstanceLock() {
      return true;
    },
  };
  let secondInstanceCalls = 0;

  const acquired = acquireDesktopInstanceLock(app, () => {
    secondInstanceCalls += 1;
  });
  handlers.get("second-instance")();

  assert.equal(acquired, true);
  assert.equal(secondInstanceCalls, 1);
});

test("завершает вторую копию до старта desktop host", () => {
  let quitCalls = 0;
  const app = {
    on() {
      throw new Error("вторая копия не должна регистрировать обработчики");
    },
    quit() {
      quitCalls += 1;
    },
    requestSingleInstanceLock() {
      return false;
    },
  };

  const acquired = acquireDesktopInstanceLock(app, () => {});

  assert.equal(acquired, false);
  assert.equal(quitCalls, 1);
});
