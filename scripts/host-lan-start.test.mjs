import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);

test("host start показывает безопасное назначение на любой OS", async () => {
  const { stdout } = await execute(process.execPath, [
    "scripts/host-lan-start.mjs",
    "--help",
  ]);

  assert.match(stdout, /host:lan:start/);
  assert.match(stdout, /доверенной домашней сети/);
  assert.match(stdout, /публичного IP/);
});

test("host start отклоняет не-LAN IPv4 до запуска Docker", async () => {
  const error = await execute(process.execPath, [
    "scripts/host-lan-start.mjs",
    "--ip",
    "8.8.8.8",
  ]).catch((failure) => failure);

  assert.notEqual(error.code, 0);
  assert.match(error.stderr, /только private IPv4/);
});

test("host start отклоняет лишние аргументы до запуска Docker", async () => {
  const error = await execute(process.execPath, [
    "scripts/host-lan-start.mjs",
    "--not-supported",
  ]).catch((failure) => failure);

  assert.notEqual(error.code, 0);
  assert.match(error.stderr, /Использование: pnpm host:lan:start/);
});
