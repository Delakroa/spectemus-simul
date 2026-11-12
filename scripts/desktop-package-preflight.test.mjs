import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const script = join(process.cwd(), "scripts", "desktop-package-preflight.mjs");

test("preflight отклоняет неизвестную platform до проверки файлов", () => {
  const result = spawnSync(process.execPath, [script, "--platform", "linux"], {
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /mac\|win/);
});

test("preflight сообщает какой packaging input отсутствует", async () => {
  const emptyRoot = await mkdtemp(join(tmpdir(), "spectemus-preflight-"));
  try {
    const result = spawnSync(process.execPath, [script, "--platform", "mac"], {
      cwd: emptyRoot,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /не подготовлен/);
  } finally {
    await rm(emptyRoot, { recursive: true, force: true });
  }
});

test("public packaging требует matching config и origin в React UI", async () => {
  const root = await mkdtemp(join(tmpdir(), "spectemus-public-preflight-"));
  const configPath = join(root, "desktop/.sidecars/public-build-config.json");
  const assetPath = join(root, "frontend/dist/assets/index.js");
  const environment = {
    ...process.env,
    SPECTEMUS_PUBLIC_BUILD_ENABLED: "true",
    SPECTEMUS_PUBLIC_API_ORIGIN: "https://app.spectemus.org",
  };
  const runPreflight = () =>
    spawnSync(process.execPath, [script, "--platform", "mac"], {
      cwd: root,
      encoding: "utf8",
      env: environment,
    });
  try {
    const requiredFiles = [
      "frontend/dist/index.html",
      "backend/build/libs/spectemus-simul-backend.jar",
      "desktop/.sidecars/runtime/bin/java",
      "desktop/.sidecars/livekit/livekit-server",
      "desktop/.sidecars/media/bin/ffmpeg",
      "desktop/.sidecars/media/bin/ffprobe",
    ];
    for (const relativePath of requiredFiles) {
      const path = join(root, relativePath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "test", { mode: 0o755 });
    }
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        internetModeEnabled: false,
        publicApiOrigin: null,
      }),
    );
    assert.match(runPreflight().stderr, /не совпадает с выбранным режимом/);

    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        internetModeEnabled: true,
        publicApiOrigin: "https://app.spectemus.org",
      }),
    );
    await mkdir(dirname(assetPath), { recursive: true });
    await writeFile(assetPath, "no public origin yet");
    assert.match(runPreflight().stderr, /не содержит доверенный public origin/);

    await writeFile(assetPath, 'const origin="https://app.spectemus.org"');
    const ready = runPreflight();
    assert.equal(ready.status, 0, ready.stderr);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
