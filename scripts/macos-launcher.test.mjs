import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const launcher = await readFile("Start-Spectemus-Simul.command", "utf8");

test("macOS launcher запускает только безопасный LAN host flow", () => {
  assert.match(launcher, /^#!\/bin\/zsh/m);
  assert.match(launcher, /cd "\$script_dir"/);
  assert.match(launcher, /pnpm host:lan:start/);
  assert.match(launcher, /LIVEKIT_NODE_IP=/);
  assert.match(launcher, /if ! open/);
  assert.match(launcher, /open "http:\/\/\$\{host_ip\}:8088"/);
  assert.doesNotMatch(launcher, /port forwarding/i);
  assert.doesNotMatch(launcher, /cloud/i);
});

test("macOS launcher оставляет ошибку видимой вместо молчаливого закрытия", () => {
  assert.match(launcher, /command -v pnpm/);
  assert.match(launcher, /docker version/);
  assert.match(launcher, /pause_on_error/);
});
