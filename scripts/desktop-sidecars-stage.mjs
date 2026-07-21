import { access, chmod, constants, cp, mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const options = parseOptions(process.argv.slice(2));
const root = process.cwd();
const sidecars = resolve(root, "desktop", ".sidecars");

await rm(sidecars, { recursive: true, force: true });
await mkdir(sidecars, { recursive: true, mode: 0o700 });
await stageRuntime(options.runtime, resolve(sidecars, "runtime"));
await stageLiveKit(options.livekit, resolve(sidecars, "livekit"));

console.log("[ok] Desktop sidecars подготовлены для packaging.");

async function stageRuntime(source, destination) {
  await assertReadable(source, "Java runtime");
  const executable = resolve(
    source,
    "bin",
    process.platform === "win32" ? "java.exe" : "java",
  );
  await assertExecutable(executable, "Java runtime");
  assertJavaVersion(executable);
  await cp(source, destination, { recursive: true, force: true });
}

async function stageLiveKit(source, destination) {
  await assertExecutable(source, "LiveKit Server");
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const target =
    process.platform === "win32" ? "livekit-server.exe" : "livekit-server";
  const targetPath = resolve(destination, target);
  await cp(source, targetPath, { force: true });
  if (process.platform !== "win32") {
    await chmod(targetPath, 0o755);
  }
}

function parseOptions(args) {
  const valuesArgs = args[0] === "--" ? args.slice(1) : args;
  const values = new Map();
  for (let index = 0; index < valuesArgs.length; index += 2) {
    const key = valuesArgs[index];
    const value = valuesArgs[index + 1];
    if (!key?.startsWith("--") || !value || values.has(key)) {
      throw new Error(
        "Использование: pnpm desktop:sidecars:stage -- --runtime <JAVA_HOME> --livekit <path>",
      );
    }
    values.set(key, value);
  }
  const runtime = values.get("--runtime");
  const livekit = values.get("--livekit");
  if (!runtime || !livekit) {
    throw new Error("Нужны --runtime <JAVA_HOME> и --livekit <path>.");
  }
  return { runtime: resolve(runtime), livekit: resolve(livekit) };
}

async function assertReadable(filePath, label) {
  try {
    await access(filePath, constants.R_OK);
  } catch {
    throw new Error(`${label} не найден: ${filePath}`);
  }
}

async function assertExecutable(filePath, label) {
  try {
    await access(filePath, constants.X_OK);
  } catch {
    throw new Error(`${label} не найден или не исполняемый: ${filePath}`);
  }
}

function assertJavaVersion(javaCommand) {
  const probe = spawnSync(javaCommand, ["-version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (probe.error) {
    throw new Error(
      `Не удалось запустить Java runtime: ${probe.error.message}`,
    );
  }
  const version = `${probe.stdout}\n${probe.stderr}`.match(
    /version "(\d+)/,
  )?.[1];
  if (!version || Number(version) < 25) {
    throw new Error(
      "Для desktop installer нужен Java runtime версии 25 или новее.",
    );
  }
}
