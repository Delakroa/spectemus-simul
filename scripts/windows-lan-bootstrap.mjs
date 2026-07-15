import { spawn } from "node:child_process";
import { platform } from "node:process";

const argument = process.argv.slice(2);

if (argument.includes("--help") || argument.includes("-h")) {
  console.log("Использование: pnpm infra:lan:windows [-- --ip <private-IPv4>]");
  console.log(
    "Только для доверенной домашней сети Windows: настроит LAN, запросит UAC для узких firewall-правил, поднимет Docker и выполнит doctor.",
  );
  process.exit(0);
}

if (platform !== "win32") {
  throw new Error(
    "infra:lan:windows запускается только на Windows-компьютере с Docker Desktop.",
  );
}

const ipArgumentIndex = argument.indexOf("--ip");
if (ipArgumentIndex !== -1 && !argument[ipArgumentIndex + 1]) {
  throw new Error("После --ip укажите private IPv4 Windows host-компьютера.");
}

const pnpmCommand = "pnpm.cmd";
const setupArguments = ["infra:lan:setup"];
if (ipArgumentIndex !== -1) {
  setupArguments.push("--", "--ip", argument[ipArgumentIndex + 1]);
}

await run("docker.exe", ["version", "--format", "{{.Server.Version}}"]);
await run(pnpmCommand, setupArguments);
await run("powershell.exe", [
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  "scripts/windows-lan-firewall.ps1",
]);
await run(pnpmCommand, ["infra:lan:up"]);
await run(pnpmCommand, ["infra:lan:doctor"]);

console.log(
  "[ok] Windows LAN host готов. На Mac запустите doctor с Windows IPv4.",
);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false });

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
