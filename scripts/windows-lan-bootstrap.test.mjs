import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);

test("Windows bootstrap показывает help на любой OS", async () => {
  const { stdout } = await execute(process.execPath, [
    "scripts/windows-lan-bootstrap.mjs",
    "--help",
  ]);

  assert.match(stdout, /infra:lan:windows/);
  assert.match(stdout, /доверенной домашней сети/);
});

test("Windows bootstrap не запускает LAN-настройку вне Windows", async () => {
  if (process.platform === "win32") {
    return;
  }

  const error = await execute(process.execPath, [
    "scripts/windows-lan-bootstrap.mjs",
  ]).catch((failure) => failure);

  assert.notEqual(error.code, 0);
  assert.match(error.stderr, /только на Windows-компьютере/);
});
