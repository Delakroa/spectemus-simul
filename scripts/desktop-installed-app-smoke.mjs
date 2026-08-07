import { spawnSync } from "node:child_process";
import { access, constants, stat } from "node:fs/promises";
import { resolve } from "node:path";

const { platform, appPath } = readArguments(process.argv.slice(2));
const resources = platform === "mac" ? "Contents/Resources" : "resources";
const executable =
  platform === "mac" ? "Contents/MacOS/Spectemus Simul" : "Spectemus Simul.exe";
const java = platform === "mac" ? "java" : "java.exe";
const livekit = platform === "mac" ? "livekit-server" : "livekit-server.exe";
const ffmpeg = platform === "mac" ? "ffmpeg" : "ffmpeg.exe";
const ffprobe = platform === "mac" ? "ffprobe" : "ffprobe.exe";
const required = [
  [executable, "desktop executable"],
  [`${resources}/frontend/index.html`, "React UI"],
  [
    `${resources}/sidecars/backend/spectemus-simul-backend.jar`,
    "Spring Boot jar",
  ],
  [`${resources}/sidecars/runtime/bin/${java}`, "bundled Java runtime"],
  [`${resources}/sidecars/livekit/${livekit}`, "LiveKit sidecar"],
  [`${resources}/sidecars/media/bin/${ffmpeg}`, "FFmpeg normalizer"],
  [`${resources}/sidecars/media/bin/${ffprobe}`, "FFprobe normalizer"],
];

// Наличие файла ничего не доказывает: неподписанный или карантинный бинарник
// присутствует, но убивается системой при запуске — и приложение сообщает
// «в этой сборке нет средства подготовки видео», уводя дефект не в ту подсистему.
const executables = [
  [
    `${resources}/sidecars/media/bin/${ffmpeg}`,
    ["-version"],
    "FFmpeg normalizer",
  ],
  [
    `${resources}/sidecars/media/bin/${ffprobe}`,
    ["-version"],
    "FFprobe normalizer",
  ],
  [
    `${resources}/sidecars/livekit/${livekit}`,
    ["--version"],
    "LiveKit sidecar",
  ],
];

for (const [relativePath, label] of required) {
  await assertFile(resolve(appPath, relativePath), label);
}

for (const [relativePath, args, label] of executables) {
  assertRuns(resolve(appPath, relativePath), args, label);
}

console.log(
  `[ok] ${platform} installed app содержит все runtime-компоненты и запускает media/LiveKit сайдкары.`,
);

function readArguments(args) {
  if (
    args.length !== 4 ||
    args[0] !== "--platform" ||
    !["mac", "win"].includes(args[1]) ||
    args[2] !== "--app" ||
    !args[3].trim()
  ) {
    throw new Error(
      "Использование: node scripts/desktop-installed-app-smoke.mjs --platform <mac|win> --app <install-path>",
    );
  }

  return { platform: args[1], appPath: resolve(args[3]) };
}

function assertRuns(filePath, args, label) {
  const probe = spawnSync(filePath, args, {
    encoding: "utf8",
    windowsHide: true,
  });
  if (probe.error) {
    throw new Error(
      `${label} не запускается из установленного приложения: ${probe.error.code ?? probe.error.message} (${filePath})`,
    );
  }
  if (probe.signal) {
    throw new Error(
      `${label} остановлен системой по сигналу ${probe.signal}: вероятны карантин или отсутствие подписи (${filePath})`,
    );
  }
  if (probe.status !== 0) {
    const firstLine = String(probe.stderr ?? "")
      .split("\n")
      .find((line) => line.trim().length > 0);
    throw new Error(
      `${label} завершился с кодом ${probe.status}${firstLine ? `: ${firstLine.trim()}` : ""} (${filePath})`,
    );
  }
}

async function assertFile(filePath, label) {
  try {
    await access(filePath, constants.R_OK);
    const file = await stat(filePath);
    if (!file.isFile() || file.size === 0) {
      throw new Error("не является непустым файлом");
    }
  } catch {
    throw new Error(
      `${label} не найден в установленном приложении: ${filePath}`,
    );
  }
}
