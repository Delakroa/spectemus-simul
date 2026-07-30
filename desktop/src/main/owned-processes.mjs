import { execFile } from "node:child_process";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const FILE_NAME = "owned-sidecars.json";
const execFileAsync = promisify(execFile);

export async function recoverOwnedSidecars({
  runtimeDirectory,
  inspectCommand = inspectProcessCommand,
  terminate = terminateProcess,
  waitForExit = waitForProcessExit,
} = {}) {
  const filePath = join(runtimeDirectory, FILE_NAME);
  const record = await readRecord(filePath);
  if (!record) return [];

  const recovered = [];
  for (const process of record.processes) {
    const command = await inspectCommand(process.pid);
    if (
      !command ||
      !process.commandIncludes.every((value) => command.includes(value))
    )
      continue;
    await terminate(process.pid);
    await waitForExit(process.pid);
    recovered.push(process.name);
  }
  await rm(filePath, { force: true });
  return recovered;
}

export async function writeOwnedSidecars({ runtimeDirectory, processes }) {
  const filePath = join(runtimeDirectory, FILE_NAME);
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify({ version: 1, processes })}\n`,
    { mode: 0o600 },
  );
  await rename(temporaryPath, filePath);
}

export async function clearOwnedSidecars(runtimeDirectory) {
  await rm(join(runtimeDirectory, FILE_NAME), { force: true });
}

async function readRecord(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    if (!Array.isArray(parsed?.processes)) return null;
    const processes = parsed.processes.filter(
      (entry) =>
        Number.isInteger(entry?.pid) &&
        entry.pid > 0 &&
        typeof entry.name === "string" &&
        Array.isArray(entry.commandIncludes) &&
        entry.commandIncludes.every((value) => typeof value === "string"),
    );
    return processes.length === parsed.processes.length ? { processes } : null;
  } catch {
    return null;
  }
}

async function inspectProcessCommand(pid) {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`,
      ]);
      return stdout.trim() || null;
    }
    const { stdout } = await execFileAsync("ps", [
      "-p",
      String(pid),
      "-o",
      "command=",
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function terminateProcess(pid) {
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function waitForProcessExit(pid, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Процесс Spectemus Simul ${pid} не завершился.`);
}
