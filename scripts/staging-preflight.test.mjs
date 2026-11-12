import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  isPublicIpv4,
  parseArguments,
  parseEnvironment,
  validateConfiguration,
  validatePublicConfiguration,
  verifyDns,
} from "./staging-preflight.mjs";

const validEnvironment = `
WT_STAGING_APP_DOMAIN=app.spectemus.org
WT_STAGING_RTC_DOMAIN=rtc.spectemus.org
WT_STAGING_TURN_DOMAIN=turn.spectemus.org
LIVEKIT_REDIS_PASSWORD=redis-password-that-is-long-enough
LIVEKIT_API_KEY=livekit-key
LIVEKIT_API_SECRET=livekit-secret-that-is-long-enough-for-a-server
FEEDBACK_ADMIN_TOKEN=feedback-token-that-is-long-enough-for-operations
`;

const validPublicEnvironment = `${validEnvironment}
PUBLIC_ACCESS_JDBC_URL=jdbc:postgresql://host.docker.internal:5432/spectemus
PUBLIC_ACCESS_JDBC_USERNAME=spectemus_user
PUBLIC_ACCESS_JDBC_PASSWORD=database-password-that-is-long-enough
PUBLIC_ACCESS_IDENTITY_PEPPER=identity-pepper-that-is-long-enough
PUBLIC_ACCESS_EMAIL_HOST=smtp.spectemus.org
PUBLIC_ACCESS_EMAIL_PORT=587
PUBLIC_ACCESS_EMAIL_USERNAME=mailer
PUBLIC_ACCESS_EMAIL_PASSWORD=smtp-password-that-is-long-enough
PUBLIC_ACCESS_EMAIL_FROM=hello@spectemus.org
PUBLIC_LIVEKIT_API_KEY=public-livekit-key
PUBLIC_LIVEKIT_API_SECRET=public-livekit-secret-that-is-long-enough
`;

test("parses a protected env file without leaking its values", () => {
  assert.deepEqual(parseEnvironment("VALUE=quoted # comment\n"), {
    VALUE: "quoted",
  });
  assert.throws(
    () => parseEnvironment("VALUE=one\nVALUE=two\n"),
    /задана дважды/,
  );
});

test("accepts the pnpm argument separator before staging options", () => {
  assert.deepEqual(
    parseArguments([
      "--",
      "--env-file",
      "/opt/spectemus-simul/.env",
      "--public-ipv4",
      "1.1.1.1",
      "--verify-dns",
    ]),
    {
      envFile: "/opt/spectemus-simul/.env",
      publicIpv4: "1.1.1.1",
      verifyDns: true,
      publicMode: false,
    },
  );
});

test("--public opts into strict Internet staging preflight", () => {
  assert.equal(
    parseArguments(["--env-file", "/tmp/staging.env", "--public"]).publicMode,
    true,
  );
});

test("accepts distinct public domains and strong non-sample secrets", () => {
  const result = validateConfiguration(parseEnvironment(validEnvironment));

  assert.deepEqual(result.problems, []);
  assert.deepEqual(
    result.domains.map(({ value }) => value),
    ["app.spectemus.org", "rtc.spectemus.org", "turn.spectemus.org"],
  );
});

test("accepts complete public access settings only when explicitly requested", () => {
  const values = parseEnvironment(validPublicEnvironment);
  assert.deepEqual(
    validateConfiguration(values, { publicMode: true }).problems,
    [],
  );
  assert.deepEqual(
    validateConfiguration(parseEnvironment(validEnvironment)).problems,
    [],
  );
  assert.ok(
    validateConfiguration(parseEnvironment(validEnvironment), {
      publicMode: true,
    }).problems.some((problem) => problem.includes("PUBLIC_ACCESS_JDBC_URL")),
  );
});

test("rejects public placeholders, dev LiveKit keys and credentials inside JDBC URL", () => {
  const values = parseEnvironment(
    validPublicEnvironment
      .replace("public-livekit-key", "devkey")
      .replace(
        "database-password-that-is-long-enough",
        "replace-with-db-password",
      )
      .replace(
        "jdbc:postgresql://host.docker.internal:5432/spectemus",
        "jdbc:postgresql://user:password@localhost:5432/spectemus",
      ),
  );
  const problems = validatePublicConfiguration(values);
  assert.ok(
    problems.some((problem) => problem.includes("PUBLIC_LIVEKIT_API_KEY")),
  );
  assert.ok(
    problems.some((problem) => problem.includes("PUBLIC_ACCESS_JDBC_PASSWORD")),
  );
  assert.ok(
    problems.some((problem) => problem.includes("PUBLIC_ACCESS_JDBC_URL")),
  );
  assert.ok(problems.every((problem) => !problem.includes("user:password")));
});

test("public overlay is opt-in and public gateway blocks LAN and operator routes", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const base = readFileSync(`${root}infra/staging/compose.yaml`, "utf8");
  const overlay = readFileSync(
    `${root}infra/staging/public.compose.yaml`,
    "utf8",
  );
  const gateway = readFileSync(
    `${root}infra/staging/public-gateway.conf`,
    "utf8",
  );
  const caddyRoute = readFileSync(
    `${root}infra/staging/public-caddy-app-route.fragment.yaml`,
    "utf8",
  );
  const frontendDockerfile = readFileSync(`${root}frontend/Dockerfile`, "utf8");
  assert.doesNotMatch(base, /PUBLIC_ACCESS_ENABLED: "true"/);
  assert.match(overlay, /PUBLIC_ACCESS_ENABLED: "true"/);
  assert.match(overlay, /PUBLIC_LIVEKIT_ENABLED: "true"/);
  assert.match(overlay, /VITE_INTERNET_ROOM_RUNTIME_ENABLED: "true"/);
  assert.match(
    overlay,
    /PUBLIC_LIVEKIT_RTC_URL: "wss:\/\/\$\{WT_STAGING_RTC_DOMAIN/,
  );
  assert.match(
    overlay,
    /PUBLIC_LIVEKIT_API_URL: "https:\/\/\$\{WT_STAGING_RTC_DOMAIN/,
  );
  assert.match(
    frontendDockerfile,
    /ARG VITE_INTERNET_ROOM_RUNTIME_ENABLED=false/,
  );
  assert.match(frontendDockerfile, /ENV VITE_INTERNET_ROOM_RUNTIME_ENABLED=/);
  assert.match(gateway, /location \^~ \/api\/v1\/ \{ return 404; \}/);
  assert.match(gateway, /location = \/gateway-health \{ return 404; \}/);
  assert.match(gateway, /location \^~ \/actuator\/ \{ return 404; \}/);
  assert.match(gateway, /location \^~ \/api\/v2\/ \{/);
  assert.match(gateway, /listen 80 proxy_protocol;/);
  assert.match(gateway, /X-Forwarded-For \$proxy_protocol_addr;/);
  assert.match(overlay, /127\.0\.0\.1:8081\/gateway-health/);
  assert.match(caddyRoute, /proxy_protocol: v2/);
});

test("rejects sample secrets and a non-public shared domain", () => {
  const result = validateConfiguration(
    parseEnvironment(
      validEnvironment
        .replace("rtc.spectemus.org", "app.spectemus.org")
        .replace(
          "redis-password-that-is-long-enough",
          "replace-with-a-real-secret",
        ),
    ),
  );

  assert.ok(result.problems.some((problem) => problem.includes("разными")));
  assert.ok(
    result.problems.some((problem) =>
      problem.includes("LIVEKIT_REDIS_PASSWORD"),
    ),
  );
});

test("rejects known development credentials", () => {
  const result = validateConfiguration(
    parseEnvironment(
      validEnvironment
        .replace(
          "redis-password-that-is-long-enough",
          "spectemus_simul_redis_dev_only",
        )
        .replace("livekit-key", "devkey")
        .replace(
          "livekit-secret-that-is-long-enough-for-a-server",
          "devsecretdevsecretdevsecretdevsecret",
        ),
    ),
  );

  assert.equal(result.problems.length, 3);
});

test("checks all service A-records against the selected VM address", async () => {
  const domains = validateConfiguration(
    parseEnvironment(validEnvironment),
  ).domains;
  const problems = await verifyDns(domains, "1.1.1.1", async (domain) =>
    domain.startsWith("turn") ? ["1.1.1.2"] : ["1.1.1.1"],
  );

  assert.deepEqual(problems, [
    "WT_STAGING_TURN_DOMAIN (turn.spectemus.org) должен указывать на 1.1.1.1, получено: 1.1.1.2.",
  ]);
});

test("allows only public IPv4 as a VM target", () => {
  assert.equal(isPublicIpv4("1.1.1.1"), true);
  assert.equal(isPublicIpv4("192.168.1.10"), false);
  assert.equal(isPublicIpv4("127.0.0.1"), false);
  assert.equal(isPublicIpv4("203.0.113.12"), false);
});

test("rejects loopback and documentation DNS names", () => {
  const result = validateConfiguration(
    parseEnvironment(
      validEnvironment
        .replace("app.spectemus.org", "127.0.0.1")
        .replace("rtc.spectemus.org", "rtc.example.com"),
    ),
  );

  assert.ok(
    result.problems.some((problem) =>
      problem.includes("WT_STAGING_APP_DOMAIN"),
    ),
  );
  assert.ok(
    result.problems.some((problem) =>
      problem.includes("WT_STAGING_RTC_DOMAIN"),
    ),
  );
});
