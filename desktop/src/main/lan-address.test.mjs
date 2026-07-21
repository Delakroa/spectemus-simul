import assert from "node:assert/strict";
import test from "node:test";

import {
  LanAddressSelectionRequired,
  resolveLanAddress,
} from "./lan-address.mjs";

test("выбирает единственный физический private IPv4", () => {
  assert.deepEqual(
    resolveLanAddress({
      en0: [{ address: "192.168.1.42", family: "IPv4", internal: false }],
      bridge0: [{ address: "172.16.0.1", family: "IPv4", internal: false }],
    }),
    { address: "192.168.1.42", interfaceName: "en0", virtual: false },
  );
});

test("требует явный выбор при нескольких физических сетях", () => {
  assert.throws(
    () =>
      resolveLanAddress({
        en0: [{ address: "192.168.1.42", family: "IPv4", internal: false }],
        en1: [{ address: "10.0.0.12", family: "IPv4", internal: false }],
      }),
    LanAddressSelectionRequired,
  );
});

test("принимает только существующий private IPv4 из явного выбора", () => {
  const networks = {
    Ethernet: [{ address: "192.168.1.42", family: "IPv4", internal: false }],
  };
  assert.equal(
    resolveLanAddress(networks, "192.168.1.42").interfaceName,
    "Ethernet",
  );
  assert.throws(() => resolveLanAddress(networks, "8.8.8.8"), /private IPv4/);
});
