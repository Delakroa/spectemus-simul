import assert from "node:assert/strict";
import test from "node:test";

import {
  isPublicIpv4,
  parseArguments,
  parseEnvironment,
  validateConfiguration,
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
    },
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
