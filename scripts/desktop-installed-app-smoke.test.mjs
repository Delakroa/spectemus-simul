import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createIsolatedWindowsProbeEnvironment } from "./desktop-installed-app-environment.mjs";

const script = join(
  process.cwd(),
  "scripts",
  "desktop-installed-app-smoke.mjs",
);
const defaultBuildEnvironment = {
  ...process.env,
  SPECTEMUS_PUBLIC_BUILD_ENABLED: "false",
  SPECTEMUS_PUBLIC_API_ORIGIN: "",
};

test("install smoke принимает macOS app с каждым bundled компонентом", async () => {
  const appPath = await mkdtemp(join(tmpdir(), "spectemus-installed-mac-"));
  try {
    await createMacApp(appPath);

    const result = spawnSync(
      process.execPath,
      [script, "--platform", "mac", "--app", appPath],
      { encoding: "utf8", env: defaultBuildEnvironment },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /runtime-компоненты/);
  } finally {
    await rm(appPath, { recursive: true, force: true });
  }
});

test("install smoke ловит присутствующий, но незапускающийся media sidecar", async () => {
  const appPath = await mkdtemp(join(tmpdir(), "spectemus-installed-broken-"));
  try {
    await createMacApp(appPath);
    // Файл на месте и непустой, но не исполняемый — ровно то, что даёт карантин
    // Gatekeeper или отсутствие подписи у вложенного бинарника. Права снимаем
    // отдельным chmod: опция mode у writeFile применяется только при создании файла,
    // а созданная выше заглушка уже исполняемая. Без этого на Linux execvp
    // откатывается на /bin/sh, тот выполняет содержимое как команду, и сценарий
    // подменяется на «завершился с кодом N».
    const brokenFfmpeg = join(
      appPath,
      "Contents/Resources/sidecars/media/bin/ffmpeg",
    );
    await writeFile(brokenFfmpeg, "test");
    await chmod(brokenFfmpeg, 0o644);

    const result = spawnSync(
      process.execPath,
      [script, "--platform", "mac", "--app", appPath],
      { encoding: "utf8", env: defaultBuildEnvironment },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /FFmpeg normalizer не запускается/);
  } finally {
    await rm(appPath, { recursive: true, force: true });
  }
});

test("install smoke отклоняет Internet config, не совпадающий с режимом installer", async () => {
  const appPath = await mkdtemp(join(tmpdir(), "spectemus-installed-origin-"));
  try {
    await createMacApp(appPath);
    const result = spawnSync(
      process.execPath,
      [script, "--platform", "mac", "--app", appPath],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          SPECTEMUS_PUBLIC_BUILD_ENABLED: "true",
          SPECTEMUS_PUBLIC_API_ORIGIN: "https://app.spectemus.org",
        },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /неверный Internet build config/);
  } finally {
    await rm(appPath, { recursive: true, force: true });
  }
});

test("install smoke сообщает об отсутствующем Windows sidecar", async () => {
  const appPath = await mkdtemp(join(tmpdir(), "spectemus-installed-win-"));
  try {
    await createFile(appPath, "Spectemus Simul.exe");
    await createFile(appPath, "resources/frontend/index.html");
    await createBuildConfig(appPath, "resources/public-build-config.json");
    await createFile(
      appPath,
      "resources/sidecars/backend/spectemus-simul-backend.jar",
    );
    await createFile(appPath, "resources/sidecars/runtime/bin/java.exe");

    const result = spawnSync(
      process.execPath,
      [script, "--platform", "win", "--app", appPath],
      { encoding: "utf8", env: defaultBuildEnvironment },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /LiveKit sidecar не найден/);
  } finally {
    await rm(appPath, { recursive: true, force: true });
  }
});

test("Windows install smoke не видит DLL из сборочного MSYS2 PATH", () => {
  const environment = createIsolatedWindowsProbeEnvironment(
    "C:\\Spectemus\\resources\\sidecars\\media\\bin\\ffmpeg.exe",
    {
      Path: "C:\\msys64\\mingw64\\bin;C:\\tools\\node",
      SYSTEMROOT: "C:\\Windows",
      SPECTEMUS_TEST: "kept",
    },
  );

  assert.equal(environment.SPECTEMUS_TEST, "kept");
  assert.equal(environment.PATH, undefined);
  assert.doesNotMatch(environment.Path, /msys64|tools\\node/i);
  assert.match(
    environment.Path,
    /^C:\\Spectemus\\resources\\sidecars\\media\\bin;/i,
  );
  assert.match(environment.Path, /C:\\Windows\\System32/i);
});

async function createMacApp(appPath) {
  await Promise.all([
    createFile(appPath, "Contents/MacOS/Spectemus Simul"),
    createFile(appPath, "Contents/Resources/frontend/index.html"),
    createBuildConfig(appPath, "Contents/Resources/public-build-config.json"),
    createFile(
      appPath,
      "Contents/Resources/sidecars/backend/spectemus-simul-backend.jar",
    ),
    createFile(appPath, "Contents/Resources/sidecars/runtime/bin/java"),
    // Эти три smoke реально запускает, поэтому заглушки должны быть исполняемыми.
    createExecutable(
      appPath,
      "Contents/Resources/sidecars/livekit/livekit-server",
    ),
    createExecutable(appPath, "Contents/Resources/sidecars/media/bin/ffmpeg"),
    createExecutable(appPath, "Contents/Resources/sidecars/media/bin/ffprobe"),
  ]);
}

async function createBuildConfig(root, relativePath) {
  const filePath = join(root, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    JSON.stringify({
      schemaVersion: 1,
      internetModeEnabled: false,
      publicApiOrigin: null,
    }),
  );
}

async function createFile(root, relativePath) {
  const filePath = join(root, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, "test");
}

async function createExecutable(root, relativePath) {
  const filePath = join(root, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
}
