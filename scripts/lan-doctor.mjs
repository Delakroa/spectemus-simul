import { readFile } from "node:fs/promises";
import { connect } from "node:net";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { isPrivateIpv4 } from "./lan-config.mjs";

const argument = process.argv.slice(2);
const hostArgumentIndex = argument.indexOf("--host");
const isRemoteCheck = hostArgumentIndex !== -1;

if (argument.includes("--help") || argument.includes("-h")) {
  console.log(
    "Использование: pnpm infra:lan:doctor [-- --host <private-IPv4>]",
  );
  process.exit(0);
}

if (hostArgumentIndex !== -1 && !argument[hostArgumentIndex + 1]) {
  throw new Error("После --host укажите private IPv4 компьютера с Docker.");
}

const host =
  hostArgumentIndex === -1
    ? readLanHost(
        await readFile(resolve(process.cwd(), "infra/lan.env"), "utf8"),
      )
    : argument[hostArgumentIndex + 1];

if (!isPrivateIpv4(host)) {
  throw new Error("LAN doctor принимает только private IPv4 host-компьютера.");
}

const origin = `http://${host}:8088`;

try {
  await verifyGateway(origin);
  console.log(`[ok] gateway: ${origin}/gateway-health`);

  await verifyTcp(host, 7880);
  console.log(`[ok] LiveKit signalling TCP: ${host}:7880`);

  await verifyTcp(host, 7881);
  console.log(`[ok] LiveKit TCP fallback: ${host}:7881`);

  await verifyTokenUrl(origin, host);
  console.log(`[ok] token response returns ws://${host}:7880`);
  console.log(
    "[ok] LAN control path готов. UDP 50000-50100 проверяется реальным просмотром.",
  );
} catch (error) {
  console.error(
    `[blocked] LAN проверка ${origin} не пройдена: ${messageOf(error)}`,
  );
  printRecoveryHint(error, isRemoteCheck);
  process.exitCode = 1;
}

function readLanHost(content) {
  const match = content.match(/^LIVEKIT_NODE_IP=(.+)$/m);
  if (!match) {
    throw new Error(
      "В infra/lan.env не задан LIVEKIT_NODE_IP. Сначала выполните pnpm infra:lan:setup.",
    );
  }

  return match[1].trim();
}

async function verifyGateway(origin) {
  const response = await fetch(`${origin}/gateway-health`, {
    signal: AbortSignal.timeout(5_000),
  });
  const body = await response.text();

  if (!response.ok || body.trim() !== "ok") {
    throw new Error(`gateway-health вернул HTTP ${response.status}`);
  }
}

function verifyTcp(host, port) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`таймаут TCP ${host}:${port}`));
    }, 5_000);

    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.end();
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function verifyTokenUrl(origin, host) {
  const created = await fetch(`${origin}/api/v1/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `lan-doctor-${randomUUID()}`,
    },
    body: JSON.stringify({ hostDisplayName: "LAN doctor" }),
    signal: AbortSignal.timeout(5_000),
  });

  if (created.status !== 201) {
    throw new Error(
      `создание проверочной комнаты вернуло HTTP ${created.status}`,
    );
  }

  const body = await created.json();
  const session = created.headers
    .get("set-cookie")
    ?.match(/wt_session=([^;]+)/)?.[1];
  if (!session || typeof body.room?.roomId !== "string") {
    throw new Error(
      "создание проверочной комнаты не вернуло session или roomId",
    );
  }

  try {
    const token = await fetch(
      `${origin}/api/v1/rooms/${body.room.roomId}/livekit-token`,
      {
        method: "POST",
        headers: { Cookie: `wt_session=${session}` },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (token.status !== 200) {
      throw new Error(`выдача LiveKit token вернула HTTP ${token.status}`);
    }

    const tokenBody = await token.json();

    if (tokenBody.liveKitUrl !== `ws://${host}:7880`) {
      throw new Error("token response вернул не тот LiveKit URL");
    }
  } finally {
    await fetch(`${origin}/api/v1/rooms/${body.room.roomId}/close`, {
      method: "POST",
      headers: {
        Cookie: `wt_session=${session}`,
        "X-Host-Secret": body.hostSecret,
      },
      signal: AbortSignal.timeout(5_000),
    }).catch(() => undefined);
  }
}

function printRecoveryHint(error, isRemoteCheck) {
  const message = messageOf(error);

  if (message.includes("HTTP 502")) {
    console.error(
      "Gateway доступен, но backend ещё не готов. Дождитесь healthy и повторите doctor.",
    );
    return;
  }

  if (!isRemoteCheck) {
    console.error(
      "Проверьте локальный Docker-стек: pnpm infra:lan:up, затем повторите doctor.",
    );
    return;
  }

  console.error(
    "На Windows host проверьте профиль сети Private и Docker Desktop.",
  );
  console.error("Откройте PowerShell от имени администратора и выполните:");
  console.error(
    'New-NetFirewallRule -DisplayName "Watch Together LAN TCP" -Direction Inbound -Action Allow -Profile Private -Protocol TCP -LocalPort 8088,7880,7881',
  );
  console.error(
    'New-NetFirewallRule -DisplayName "Watch Together LAN UDP" -Direction Inbound -Action Allow -Profile Private -Protocol UDP -LocalPort 50000-50100',
  );
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
