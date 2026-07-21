import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";

const script = join(process.cwd(), "scripts", "desktop-signing-preflight.mjs");

test("signing preflight перечисляет недостающие macOS credentials", () => {
  const result = spawnSync(process.execPath, [script, "--platform", "mac"], {
    encoding: "utf8",
    env: {},
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CSC_LINK/);
  assert.match(result.stderr, /APPLE_TEAM_ID/);
});

test("signing preflight принимает полный Windows credential set", () => {
  const result = spawnSync(process.execPath, [script, "--platform", "win"], {
    encoding: "utf8",
    env: {
      WIN_CSC_LINK: "https://secrets.example/certificate.p12",
      WIN_CSC_KEY_PASSWORD: "test-password",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /credentials/);
});
