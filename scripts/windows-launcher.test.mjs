import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const launcher = await readFile("Start-Spectemus-Simul.cmd", "utf8");

test("Windows launcher запускает только безопасный LAN host flow", () => {
  assert.match(launcher, /cd \/d "%~dp0"/);
  assert.match(launcher, /call pnpm\.cmd host:lan:start/);
  assert.match(launcher, /LIVEKIT_NODE_IP=/);
  assert.match(launcher, /http:\/\/%SPECTEMUS_HOST_IP%:8088/);
  assert.doesNotMatch(launcher, /port forwarding/i);
  assert.doesNotMatch(launcher, /cloud/i);
});

test("Windows launcher запускает Docker Desktop и оставляет ошибку видимой", () => {
  assert.match(launcher, /:missing_pnpm/);
  assert.match(launcher, /:missing_docker/);
  assert.match(launcher, /%ProgramFiles%\\Docker\\Docker\\Docker Desktop\.exe/);
  assert.match(launcher, /%LOCALAPPDATA%\\Docker\\Docker Desktop\.exe/);
  assert.match(launcher, /start "" "%SPECTEMUS_DOCKER_DESKTOP%"/);
  assert.match(launcher, /SPECTEMUS_DOCKER_ATTEMPT% GEQ 60/);
  assert.match(launcher, /timeout \/t 2 \/nobreak/);
  assert.match(launcher, /:docker_timeout/);
  assert.match(launcher, /pause/);
});
