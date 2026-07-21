import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function loadOrCreateInstallationSecrets(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    if (isInstallationSecrets(parsed)) {
      return parsed;
    }
    throw new Error("Файл секретов desktop host повреждён.");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const secrets = {
    livekitApiKey: `s2_${randomBytes(12).toString("hex")}`,
    livekitApiSecret: randomBytes(32).toString("base64url"),
  };
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(secrets)}\n`, {
    mode: 0o600,
  });
  await rename(temporaryPath, filePath);
  return secrets;
}

export async function writeLiveKitConfig(filePath, ports) {
  const config = `port: ${ports.livekitHttp}\n\nrtc:\n  tcp_port: ${ports.livekitTcp}\n  port_range_start: ${ports.livekitUdpStart}\n  port_range_end: ${ports.livekitUdpEnd}\n  use_external_ip: false\n  enable_loopback_candidate: true\n  allow_tcp_fallback: true\n\nlogging:\n  level: info\n\nroom:\n  empty_timeout: 300\n  departure_timeout: 30\n`;
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFile(filePath, config, { mode: 0o600 });
  return filePath;
}

function isInstallationSecrets(value) {
  return (
    value &&
    typeof value.livekitApiKey === "string" &&
    value.livekitApiKey.length > 0 &&
    typeof value.livekitApiSecret === "string" &&
    value.livekitApiSecret.length >= 32
  );
}
