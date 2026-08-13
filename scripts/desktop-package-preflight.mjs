import { access, constants } from "node:fs/promises";
import { resolve } from "node:path";

const platform = readPlatform(process.argv.slice(2));
const root = process.cwd();
const executable = platform === "win" ? "java.exe" : "java";
const livekit = platform === "win" ? "livekit-server.exe" : "livekit-server";
const ffmpeg = platform === "win" ? "ffmpeg.exe" : "ffmpeg";
const ffprobe = platform === "win" ? "ffprobe.exe" : "ffprobe";
const required = [
  [resolve(root, "frontend", "dist", "index.html"), "собранный React UI"],
  [
    resolve(root, "backend", "build", "libs", "spectemus-simul-backend.jar"),
    "Spring Boot jar",
  ],
  [
    resolve(root, "desktop", ".sidecars", "runtime", "bin", executable),
    "bundled Java 25 runtime",
    true,
  ],
  [
    resolve(root, "desktop", ".sidecars", "livekit", livekit),
    "LiveKit sidecar",
    true,
  ],
  [
    resolve(root, "desktop", ".sidecars", "media", "bin", ffmpeg),
    "FFmpeg normalizer",
    true,
  ],
  [
    resolve(root, "desktop", ".sidecars", "media", "bin", ffprobe),
    "FFprobe normalizer",
    true,
  ],
];
if (platform === "win") {
  required.push(
    [
      resolve(
        root,
        "desktop",
        ".sidecars",
        "media",
        "bin",
        "libgcc_s_seh-1.dll",
      ),
      "MinGW GCC runtime",
    ],
    [
      resolve(root, "desktop", ".sidecars", "media", "bin", "libstdc++-6.dll"),
      "MinGW C++ runtime",
    ],
    [
      resolve(
        root,
        "desktop",
        ".sidecars",
        "media",
        "bin",
        "libwinpthread-1.dll",
      ),
      "MinGW winpthreads runtime",
    ],
    [
      resolve(root, "desktop", ".sidecars", "media", "MINGW-GCC-COPYING3.txt"),
      "GCC runtime license",
    ],
    [
      resolve(
        root,
        "desktop",
        ".sidecars",
        "media",
        "MINGW-GCC-RUNTIME-EXCEPTION.txt",
      ),
      "GCC Runtime Library Exception",
    ],
    [
      resolve(
        root,
        "desktop",
        ".sidecars",
        "media",
        "MINGW-WINPTHREAD-LICENSE.txt",
      ),
      "winpthreads license",
    ],
    [
      resolve(
        root,
        "desktop",
        ".sidecars",
        "media",
        "MINGW-RUNTIME-NOTICE.txt",
      ),
      "MinGW runtime notice",
    ],
  );
}

for (const [filePath, label, executableFile] of required) {
  await assertAvailable(filePath, label, executableFile);
}

console.log(`[ok] ${platform} packaging input готов.`);

function readPlatform(args) {
  if (
    args.length !== 2 ||
    args[0] !== "--platform" ||
    !["mac", "win"].includes(args[1])
  ) {
    throw new Error(
      "Использование: node scripts/desktop-package-preflight.mjs --platform <mac|win>",
    );
  }
  return args[1];
}

async function assertAvailable(filePath, label, executableFile = false) {
  try {
    await access(filePath, executableFile ? constants.X_OK : constants.R_OK);
  } catch {
    throw new Error(
      `${label} не подготовлен${executableFile ? " или не исполняемый" : ""}: ${filePath}`,
    );
  }
}
