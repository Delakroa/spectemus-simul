import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createPublicBuildConfig,
  loadPublicBuildConfig,
  parsePublicBuildConfig,
  PUBLIC_BUILD_CONFIG_NAME,
} from "./public-build-config.mjs";

test("packaged desktop reads only the embedded HTTPS origin, never process env", async () => {
  const resourcesPath = await mkdtemp(
    join(tmpdir(), "spectemus-public-build-"),
  );
  try {
    await writeFile(
      join(resourcesPath, PUBLIC_BUILD_CONFIG_NAME),
      JSON.stringify(
        createPublicBuildConfig({
          enabled: true,
          rawOrigin: "https://app.spectemus.org",
        }),
      ),
    );
    assert.deepEqual(
      await loadPublicBuildConfig({
        packaged: true,
        resourcesPath,
        environment: {
          SPECTEMUS_PUBLIC_API_ORIGIN: "https://attacker.example.org",
        },
      }),
      {
        schemaVersion: 1,
        internetModeEnabled: true,
        publicApiOrigin: "https://app.spectemus.org",
      },
    );
  } finally {
    await rm(resourcesPath, { recursive: true, force: true });
  }
});

test("missing packaged config stays disabled even when env contains an origin", async () => {
  const resourcesPath = await mkdtemp(
    join(tmpdir(), "spectemus-public-build-"),
  );
  try {
    assert.deepEqual(
      await loadPublicBuildConfig({
        packaged: true,
        resourcesPath,
        environment: {
          SPECTEMUS_PUBLIC_API_ORIGIN: "https://app.spectemus.org",
        },
      }),
      createPublicBuildConfig(),
    );
  } finally {
    await rm(resourcesPath, { recursive: true, force: true });
  }
});

test("invalid config and LAN/Internet hybrids fail closed", () => {
  assert.throws(() => parsePublicBuildConfig("{"), /Invalid desktop/);
  assert.throws(
    () =>
      parsePublicBuildConfig(
        JSON.stringify({
          schemaVersion: 1,
          internetModeEnabled: true,
          publicApiOrigin: "http://127.0.0.1:8088",
        }),
      ),
    /public https/,
  );
  assert.throws(
    () =>
      parsePublicBuildConfig(
        JSON.stringify({
          schemaVersion: 1,
          internetModeEnabled: false,
          publicApiOrigin: "https://app.spectemus.org",
        }),
      ),
    /must not contain an origin/,
  );
  assert.throws(
    () =>
      parsePublicBuildConfig(
        JSON.stringify({
          schemaVersion: 1,
          internetModeEnabled: true,
          publicApiOrigin: "https://app.spectemus.org/",
        }),
      ),
    /not canonical/,
  );
});
