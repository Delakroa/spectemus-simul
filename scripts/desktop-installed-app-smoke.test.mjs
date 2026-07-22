import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const script = join(
  process.cwd(),
  "scripts",
  "desktop-installed-app-smoke.mjs",
);

test("install smoke принимает macOS app с каждым bundled компонентом", async () => {
  const appPath = await mkdtemp(join(tmpdir(), "spectemus-installed-mac-"));
  try {
    await createMacApp(appPath);

    const result = spawnSync(
      process.execPath,
      [script, "--platform", "mac", "--app", appPath],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /runtime-компоненты/);
  } finally {
    await rm(appPath, { recursive: true, force: true });
  }
});

test("install smoke сообщает об отсутствующем Windows sidecar", async () => {
  const appPath = await mkdtemp(join(tmpdir(), "spectemus-installed-win-"));
  try {
    await createFile(appPath, "Spectemus Simul.exe");
    await createFile(appPath, "resources/frontend/index.html");
    await createFile(
      appPath,
      "resources/sidecars/backend/watch-together-backend.jar",
    );
    await createFile(appPath, "resources/sidecars/runtime/bin/java.exe");

    const result = spawnSync(
      process.execPath,
      [script, "--platform", "win", "--app", appPath],
      { encoding: "utf8" },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /LiveKit sidecar не найден/);
  } finally {
    await rm(appPath, { recursive: true, force: true });
  }
});

async function createMacApp(appPath) {
  await Promise.all([
    createFile(appPath, "Contents/MacOS/Spectemus Simul"),
    createFile(appPath, "Contents/Resources/frontend/index.html"),
    createFile(
      appPath,
      "Contents/Resources/sidecars/backend/watch-together-backend.jar",
    ),
    createFile(appPath, "Contents/Resources/sidecars/runtime/bin/java"),
    createFile(appPath, "Contents/Resources/sidecars/livekit/livekit-server"),
  ]);
}

async function createFile(root, relativePath) {
  const filePath = join(root, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, "test");
}
