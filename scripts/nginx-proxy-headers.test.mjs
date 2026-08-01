import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const gatewayConfig = await readFile(
  new URL("../infra/nginx/default.conf", import.meta.url),
  "utf8",
);

test("gateway overwrites client-controlled X-Forwarded-For before proxying to backend", () => {
  const apiLocation = gatewayConfig.match(
    /location \/api\/ \{(?<body>[\s\S]*?)\n  \}/,
  )?.groups?.body;
  const actuatorLocation = gatewayConfig.match(
    /location \/actuator\/ \{(?<body>[\s\S]*?)\n  \}/,
  )?.groups?.body;

  assert.match(
    apiLocation ?? "",
    /proxy_set_header X-Forwarded-For \$remote_addr;/,
  );
  assert.match(
    actuatorLocation ?? "",
    /proxy_set_header X-Forwarded-For \$remote_addr;/,
  );
  assert.doesNotMatch(
    gatewayConfig,
    /proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;/,
  );
});
