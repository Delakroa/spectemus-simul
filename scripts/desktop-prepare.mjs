import { spawn } from "node:child_process";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicBuildConfig,
  PUBLIC_BUILD_CONFIG_NAME,
} from "../desktop/src/main/public-build-config.mjs";
import { buildWindowsPnpmInvocation } from "./windows-command.mjs";

const RESERVED_SUFFIXES = [
  ".test",
  ".example",
  ".invalid",
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home.arpa",
];

export function resolveDesktopBuildSettings(environment) {
  const flag = environment.SPECTEMUS_PUBLIC_BUILD_ENABLED;
  if (flag && flag !== "true" && flag !== "false") {
    throw new Error(
      "SPECTEMUS_PUBLIC_BUILD_ENABLED должен быть true или false",
    );
  }
  const config = createPublicBuildConfig({
    enabled: flag === "true",
    rawOrigin: environment.SPECTEMUS_PUBLIC_API_ORIGIN,
  });
  if (config.internetModeEnabled) {
    const hostname = new URL(config.publicApiOrigin).hostname.toLowerCase();
    if (
      hostname.length > 253 ||
      !hostname.includes(".") ||
      hostname.endsWith(".") ||
      !hostname
        .split(".")
        .every((label) =>
          /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
        ) ||
      hostname === "example.com" ||
      hostname.endsWith(".example.com") ||
      RESERVED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
    ) {
      throw new Error(
        "Для Internet desktop build нужен реальный публичный домен",
      );
    }
  }
  return {
    config,
    frontendEnvironment: {
      ...environment,
      VITE_API_BASE_URL: "",
      VITE_INTERNET_ROOM_RUNTIME_ENABLED: config.internetModeEnabled
        ? "true"
        : "false",
      VITE_INTERNET_APP_ORIGIN: config.publicApiOrigin ?? "",
    },
  };
}

export async function prepareDesktopBuild({
  root,
  environment = process.env,
  runCommand = runBuildCommand,
}) {
  const configDirectory = join(root, "desktop", ".sidecars");
  const configPath = join(configDirectory, PUBLIC_BUILD_CONFIG_NAME);
  await rm(configPath, { force: true });
  const { config, frontendEnvironment } =
    resolveDesktopBuildSettings(environment);
  await runCommand("pnpm", ["--dir", "frontend", "build"], {
    cwd: root,
    env: frontendEnvironment,
  });
  await runCommand(
    process.execPath,
    ["scripts/run-gradle.mjs", ":backend:bootJar", "--no-daemon"],
    { cwd: root, env: environment },
  );
  await mkdir(configDirectory, { recursive: true, mode: 0o700 });
  const tempPath = `${configPath}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(config)}\n`, { mode: 0o600 });
    await rename(tempPath, configPath);
  } finally {
    await rm(tempPath, { force: true });
  }
  return config;
}

async function runBuildCommand(command, args, options) {
  const invocation =
    process.platform === "win32" && command === "pnpm"
      ? buildWindowsPnpmInvocation(args, process.env.ComSpec || "cmd.exe")
      : { command, args };
  await new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} build failed (${code})`)),
    );
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (
    process.argv.length > 3 ||
    (process.argv[2] && process.argv[2] !== "--validate-only")
  ) {
    throw new Error(
      "Использование: node scripts/desktop-prepare.mjs [--validate-only]",
    );
  }
  if (process.argv[2] === "--validate-only") {
    resolveDesktopBuildSettings(process.env);
    console.log("[ok] Desktop build mode задан корректно.");
  } else {
    await prepareDesktopBuild({ root: process.cwd() });
    console.log("[ok] Desktop UI, backend и public build config подготовлены.");
  }
}
