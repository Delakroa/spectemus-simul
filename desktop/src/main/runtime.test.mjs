import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  loadOrCreateInstallationSecrets,
  writeLiveKitConfig,
} from "./runtime.mjs";

test("создаёт и повторно использует per-installation LiveKit secrets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "spectemus-runtime-"));
  const filePath = join(directory, "installation-secrets.json");

  const first = await loadOrCreateInstallationSecrets(filePath);
  const second = await loadOrCreateInstallationSecrets(filePath);

  assert.deepEqual(second, first);
  assert.match(first.livekitApiKey, /^s2_[a-f0-9]{24}$/);
  assert.ok(first.livekitApiSecret.length >= 32);
});

test("пишет single-node LiveKit config без Redis", async () => {
  const directory = await mkdtemp(join(tmpdir(), "spectemus-runtime-"));
  const filePath = join(directory, "livekit.yaml");
  await writeLiveKitConfig(filePath, {
    livekitHttp: 7880,
    livekitTcp: 7881,
    livekitUdpStart: 50000,
    livekitUdpEnd: 50100,
  });

  const config = await readFile(filePath, "utf8");
  assert.match(config, /port: 7880/);
  assert.match(config, /tcp_port: 7881/);
  assert.doesNotMatch(config, /redis/i);
});
