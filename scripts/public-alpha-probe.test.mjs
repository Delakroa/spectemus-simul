import assert from "node:assert/strict";
import test from "node:test";

import {
  parseProbeArguments,
  runPublicAlphaProbe,
} from "./public-alpha-probe.mjs";

const domains = {
  app: "app.spectemus.org",
  rtc: "rtc.spectemus.org",
  turn: "turn.spectemus.org",
};

function pageHeaders() {
  return {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy":
      "default-src 'self'; connect-src 'self' wss://rtc.spectemus.org",
    "strict-transport-security": "max-age=63072000; includeSubDomains",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

function testProbe({ responses = {}, tlsFailure } = {}) {
  const requests = [];
  const tlsHosts = [];
  return {
    requests,
    tlsHosts,
    request: async (url, options) => {
      const probePath = new URL(url).pathname;
      requests.push({ url, options });
      const result = responses[probePath];
      if (result instanceof Error) throw result;
      if (result) return result;
      if (probePath === "/") {
        return new Response("<html></html>", {
          status: 200,
          headers: pageHeaders(),
        });
      }
      if (probePath === "/api/v2/account") {
        return new Response(JSON.stringify({ code: "ACCOUNT_REQUIRED" }), {
          status: 401,
          headers: { "content-type": "application/problem+json" },
        });
      }
      return new Response("", { status: 404 });
    },
    tlsProbe: async (host) => {
      tlsHosts.push(host);
      if (host === tlsFailure) throw new Error("private certificate details");
    },
  };
}

test("CLI accepts only three public DNS names", () => {
  assert.deepEqual(
    parseProbeArguments([
      "--",
      "--app-domain",
      domains.app,
      "--rtc-domain",
      domains.rtc,
      "--turn-domain",
      domains.turn,
    ]),
    domains,
  );
  assert.throws(() => parseProbeArguments([]), /Укажите три/);
  assert.throws(
    () => parseProbeArguments(["--env-file", "/tmp/x"]),
    /Использование/,
  );
});

test("read-only probe checks TLS, public HTML, private routes and anonymous v2", async () => {
  const probe = testProbe();
  assert.deepEqual(await runPublicAlphaProbe(domains, probe), {
    tls: ["app", "rtc", "turn"],
    privateRoutes: 4,
    publicApi: "unauthenticated account request rejected",
  });
  assert.deepEqual(probe.tlsHosts, [
    "app.spectemus.org",
    "rtc.spectemus.org",
    "turn.spectemus.org",
  ]);
  assert.deepEqual(
    probe.requests.map(({ url }) => new URL(url).pathname),
    [
      "/",
      "/api/v1/rooms",
      "/actuator/health",
      "/operator/",
      "/gateway-health",
      "/api/v2/account",
    ],
  );
  assert.ok(
    probe.requests.every(
      ({ options }) =>
        options.method === "GET" && options.redirect === "manual",
    ),
  );
  assert.ok(
    probe.requests.every(({ options }) =>
      Object.keys(options.headers).every((key) => key === "Accept"),
    ),
  );
});

test("invalid domains fail before any network call", async () => {
  const probe = testProbe();
  await assert.rejects(
    runPublicAlphaProbe({ ...domains, rtc: "localhost" }, probe),
    /три разных публичных DNS-имени/,
  );
  assert.equal(probe.requests.length, 0);
  assert.equal(probe.tlsHosts.length, 0);
});

test("TLS failure stops before HTTP and hides low-level details", async () => {
  const probe = testProbe({ tlsFailure: "rtc.spectemus.org" });
  await assert.rejects(runPublicAlphaProbe(domains, probe), (error) => {
    assert.match(error.message, /rtc: доверенный TLS/);
    assert.doesNotMatch(error.message, /private certificate details/);
    return true;
  });
  assert.equal(probe.requests.length, 0);
});

test("redirect, missing security headers and exposed LAN route fail", async () => {
  for (const [responses, expected] of [
    [{ "/": new Response("", { status: 302 }) }, /ожидался HTTP 200/],
    [
      {
        "/": new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      },
      /content-security-policy/,
    ],
    [
      { "/api/v1/rooms": new Response("[]", { status: 200 }) },
      /api\/v1\/rooms: ожидался HTTP 404/,
    ],
  ]) {
    await assert.rejects(
      runPublicAlphaProbe(domains, testProbe({ responses })),
      expected,
    );
  }
});

test("anonymous public account must return structured 401, never HTML or 200", async () => {
  for (const response of [
    new Response("<html></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
    new Response("<html></html>", {
      status: 401,
      headers: { "content-type": "text/html" },
    }),
    new Response(JSON.stringify({ code: "SOMETHING_ELSE" }), {
      status: 401,
      headers: { "content-type": "application/problem+json" },
    }),
  ]) {
    await assert.rejects(
      runPublicAlphaProbe(
        domains,
        testProbe({ responses: { "/api/v2/account": response } }),
      ),
      /api\/v2\/account/,
    );
  }
});

test("request failures do not echo response body or network error details", async () => {
  const probe = testProbe({
    responses: { "/": new Error("sensitive-proxy-error") },
  });
  await assert.rejects(runPublicAlphaProbe(domains, probe), (error) => {
    assert.match(error.message, /HTTPS-запрос не выполнен/);
    assert.doesNotMatch(error.message, /sensitive-proxy-error/);
    return true;
  });
});
