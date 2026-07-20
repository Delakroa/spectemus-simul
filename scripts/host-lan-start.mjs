import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { platform } from "node:process";

import { isPrivateIpv4 } from "./lan-config.mjs";
import { buildWindowsPnpmInvocation } from "./windows-command.mjs";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log("Использование: pnpm host:lan:start [-- --ip <private-IPv4>]");
  console.log(
    "Запускает Spectemus Simul на компьютере host для доверенной домашней сети: настраивает LAN, поднимает Docker и проверяет готовность.",
  );
  console.log(
    "Не используйте для публичного IP, port forwarding, VPN exit node или облачной VM.",
  );
  process.exit(0);
}

const ipArgumentIndex = args.indexOf("--ip");
if (ipArgumentIndex !== -1 && !args[ipArgumentIndex + 1]) {
  throw new Error("После --ip укажите private IPv4 компьютера host-а.");
}

const hostIp = ipArgumentIndex === -1 ? null : args[ipArgumentIndex + 1];
if (
  args.length !== (hostIp === null ? 0 : 2) ||
  args.filter((arg) => arg === "--ip").length > 1
) {
  throw new Error(
    "Использование: pnpm host:lan:start [-- --ip <private-IPv4>]",
  );
}
if (hostIp !== null && !isPrivateIpv4(hostIp)) {
  throw new Error(
    "Для host:lan:start разрешён только private IPv4 домашней сети.",
  );
}

const setupArgs = ["infra:lan:setup"];
if (hostIp !== null) {
  setupArgs.push("--", "--ip", hostIp);
}

if (platform === "win32") {
  const windowsArgs = ["infra:lan:windows"];
  if (hostIp !== null) {
    windowsArgs.push("--", "--ip", hostIp);
  }
  await runPnpm(windowsArgs);
} else {
  await run("docker", ["version", "--format", "{{.Server.Version}}"]);
  await runPnpm(setupArgs);
  await runPnpm(["infra:lan:up"]);
  await runPnpm(["infra:lan:doctor"]);
}

const lanEnv = await readFile(resolve(process.cwd(), "infra/lan.env"), "utf8");
const configuredIp = lanEnv.match(/^LIVEKIT_NODE_IP=(.+)$/m)?.[1];
if (!configuredIp) {
  throw new Error("Не удалось определить LAN-адрес host-а из infra/lan.env.");
}

console.log(`[ok] Host mode готов: http://${configuredIp}:8088`);
console.log(
  "Создайте комнату по этому адресу и отправьте гостю созданную ссылку.",
);

function run(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      shell: false,
      stdio: "inherit",
    });

    child.once("error", (error) => {
      reject(
        new Error(
          `Не удалось запустить ${command}. Проверьте Node.js, pnpm и Docker Desktop: ${error.message}`,
        ),
      );
    });
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} завершился с кодом ${code ?? "unknown"}.`));
    });
  });
}

function runPnpm(pnpmArgs) {
  if (platform === "win32") {
    const invocation = buildWindowsPnpmInvocation(
      pnpmArgs,
      process.env.ComSpec ?? "cmd.exe",
    );
    return run(invocation.command, invocation.args);
  }

  return run("pnpm", pnpmArgs);
}
