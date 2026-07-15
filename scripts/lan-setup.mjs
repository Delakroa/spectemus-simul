import { networkInterfaces } from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  isPrivateIpv4,
  selectLanAddress,
  updateLanEnv,
} from "./lan-config.mjs";

const argument = process.argv.slice(2);
const helpRequested = argument.includes("--help") || argument.includes("-h");
const ipArgumentIndex = argument.indexOf("--ip");

if (helpRequested) {
  console.log("Использование: pnpm infra:lan:setup [-- --ip <private-IPv4>]");
  process.exit(0);
}

if (ipArgumentIndex !== -1 && !argument[ipArgumentIndex + 1]) {
  throw new Error("После --ip укажите private IPv4 host-компьютера.");
}

const specifiedIp =
  ipArgumentIndex === -1 ? null : argument[ipArgumentIndex + 1];
const selected = specifiedIp
  ? { address: specifiedIp, interfaceName: "вручную" }
  : selectLanAddress(networkInterfaces());

if (!isPrivateIpv4(selected.address)) {
  throw new Error("Параметр --ip должен быть private IPv4 host-компьютера.");
}

const target = resolve(process.cwd(), "infra/lan.env");
const previous = await readFile(target, "utf8").catch((error) => {
  if (error.code === "ENOENT") {
    return null;
  }

  throw error;
});

await writeFile(target, updateLanEnv(previous, selected.address), "utf8");

if (previous !== null) {
  console.log("[ok] infra/lan.env обновлён: прежний LAN-адрес заменён.");
} else {
  console.log("[ok] infra/lan.env создан.");
}
console.log(`[ok] host IPv4: ${selected.address} (${selected.interfaceName})`);
console.log("Далее: pnpm infra:lan:up && pnpm infra:lan:doctor");
