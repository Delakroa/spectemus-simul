import { access, constants } from "node:fs/promises";
import { resolve } from "node:path";

const platform = readPlatform(process.argv.slice(2));
const root = process.cwd();
const executable = platform === "win" ? "java.exe" : "java";
const livekit = platform === "win" ? "livekit-server.exe" : "livekit-server";
const required = [
  [resolve(root, "frontend", "dist", "index.html"), "собранный React UI"],
  [
    resolve(root, "backend", "build", "libs", "backend-0.1.0-SNAPSHOT.jar"),
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
];

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
