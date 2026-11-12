import { connect } from "node:tls";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isPublicHostname } from "./staging-preflight.mjs";

const REQUEST_TIMEOUT_MS = 8_000;
const PRIVATE_PATHS = [
  "/api/v1/rooms",
  "/actuator/health",
  "/operator/",
  "/gateway-health",
];

export function parseProbeArguments(args) {
  const values = args.at(0) === "--" ? args.slice(1) : args;
  const optionNames = {
    "--app-domain": "app",
    "--rtc-domain": "rtc",
    "--turn-domain": "turn",
  };
  const domains = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = optionNames[values[index]];
    const value = values[index + 1];
    if (!key || !value || Object.hasOwn(domains, key)) {
      throw new Error(
        "Использование: pnpm staging:public:probe -- --app-domain <app> --rtc-domain <rtc> --turn-domain <turn>",
      );
    }
    domains[key] = value;
  }
  if (Object.keys(domains).length !== 3) {
    throw new Error(
      "Укажите три публичных DNS-имени: --app-domain, --rtc-domain и --turn-domain",
    );
  }
  return domains;
}

export async function probeTrustedTls(host, timeoutMs = REQUEST_TIMEOUT_MS) {
  await new Promise((resolve, reject) => {
    const socket = connect({
      host,
      port: 443,
      servername: host,
      rejectUnauthorized: true,
    });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.setTimeout(timeoutMs, () => finish(new Error("TLS timeout")));
    socket.once("error", finish);
    socket.once("secureConnect", () =>
      socket.authorized
        ? finish()
        : finish(new Error("TLS certificate was not trusted")),
    );
  });
}

export async function runPublicAlphaProbe(
  domains,
  { request = fetch, tlsProbe = probeTrustedTls } = {},
) {
  const selected = ["app", "rtc", "turn"].map((key) =>
    domains?.[key]?.trim().toLowerCase(),
  );
  if (
    selected.some(
      (domain) =>
        !domain ||
        !isPublicHostname(domain) ||
        domain === "example.com" ||
        [".local", ".lan", ".internal", ".home.arpa"].some((suffix) =>
          domain.endsWith(suffix),
        ),
    ) ||
    new Set(selected).size !== 3
  ) {
    throw new Error("Для probe нужны три разных публичных DNS-имени");
  }
  const [app, rtc, turn] = selected;

  for (const [label, domain] of [
    ["app", app],
    ["rtc", rtc],
    ["turn", turn],
  ]) {
    try {
      await tlsProbe(domain);
    } catch {
      throw new Error(`${label}: доверенный TLS на порту 443 недоступен`);
    }
  }

  const get = async (probePath, accept) => {
    try {
      return await request(`https://${app}${probePath}`, {
        method: "GET",
        headers: { Accept: accept },
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new Error(`${probePath}: HTTPS-запрос не выполнен`);
    }
  };

  const page = await get("/", "text/html");
  try {
    expectStatus(page, 200, "/");
    if (!(page.headers.get("content-type") ?? "").includes("text/html")) {
      throw new Error("/: вместо HTML получен другой content-type");
    }
    assertPublicHeaders(page.headers, rtc);
  } finally {
    await page.body?.cancel();
  }

  for (const probePath of PRIVATE_PATHS) {
    const response = await get(probePath, "application/json");
    try {
      expectStatus(response, 404, probePath);
    } finally {
      await response.body?.cancel();
    }
  }

  const account = await get("/api/v2/account", "application/problem+json");
  try {
    expectStatus(account, 401, "/api/v2/account");
    if (
      !(account.headers.get("content-type") ?? "").includes(
        "application/problem+json",
      )
    ) {
      throw new Error(
        "/api/v2/account: вместо problem+json получен другой ответ",
      );
    }
    let problem;
    try {
      const body = await account.text();
      if (body.length > 16_384) throw new Error("problem body too large");
      problem = JSON.parse(body);
    } catch {
      throw new Error("/api/v2/account: некорректный problem+json");
    }
    if (problem?.code !== "ACCOUNT_REQUIRED") {
      throw new Error("/api/v2/account: ожидался ACCOUNT_REQUIRED");
    }
  } finally {
    if (!account.bodyUsed) await account.body?.cancel();
  }

  return {
    tls: ["app", "rtc", "turn"],
    privateRoutes: PRIVATE_PATHS.length,
    publicApi: "unauthenticated account request rejected",
  };
}

function expectStatus(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(
      `${label}: ожидался HTTP ${expected}, получен ${response.status}`,
    );
  }
}

function assertPublicHeaders(headers, rtcDomain) {
  const required = {
    "content-security-policy": [`default-src 'self'`, `wss://${rtcDomain}`],
    "strict-transport-security": ["max-age="],
    "referrer-policy": ["no-referrer"],
    "x-content-type-options": ["nosniff"],
    "x-frame-options": ["DENY"],
  };
  for (const [name, fragments] of Object.entries(required)) {
    const value = headers.get(name) ?? "";
    if (fragments.some((fragment) => !value.includes(fragment))) {
      throw new Error(`/: отсутствует или некорректен заголовок ${name}`);
    }
  }
}

async function main(args) {
  const domains = parseProbeArguments(args);
  const result = await runPublicAlphaProbe(domains);
  console.log(`[ok] доверенный TLS: ${result.tls.join(", ")}`);
  console.log("[ok] публичная HTML-страница и защитные заголовки");
  console.log(`[ok] закрыты приватные маршруты: ${result.privateRoutes}`);
  console.log("[ok] public API требует account без cookie");
  console.log(
    "Это только read-only preflight: WSS, ICE, TURN relay и медиапоток нужно проверить отдельно.",
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(`[FAIL] ${error.message}`);
    process.exitCode = 1;
  }
}
