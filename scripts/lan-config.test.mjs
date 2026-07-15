import assert from "node:assert/strict";
import test from "node:test";

import {
  collectLanAddresses,
  isPrivateIpv4,
  renderLanEnv,
  selectLanAddress,
  updateLanEnv,
} from "./lan-config.mjs";

test("распознаёт только private IPv4 для LAN", () => {
  assert.equal(isPrivateIpv4("192.168.1.146"), true);
  assert.equal(isPrivateIpv4("172.31.1.10"), true);
  assert.equal(isPrivateIpv4("10.0.0.4"), true);
  assert.equal(isPrivateIpv4("172.32.1.10"), false);
  assert.equal(isPrivateIpv4("127.0.0.1"), false);
  assert.equal(isPrivateIpv4("203.0.113.10"), false);
  assert.equal(isPrivateIpv4("192.168.1."), false);
});

test("выбирает единственный физический адаптер, игнорируя Docker bridge", () => {
  const networks = {
    Ethernet: [{ address: "192.168.1.146", family: "IPv4", internal: false }],
    "vEthernet (DockerNAT)": [
      { address: "172.20.0.1", family: "IPv4", internal: false },
    ],
  };

  assert.deepEqual(selectLanAddress(networks), {
    address: "192.168.1.146",
    interfaceName: "Ethernet",
    virtual: false,
  });
  assert.equal(collectLanAddresses(networks).length, 2);
});

test("не угадывает адрес при двух физических сетях", () => {
  const networks = {
    Ethernet: [{ address: "192.168.1.146", family: "IPv4", internal: false }],
    WiFi: [{ address: "10.0.0.12", family: "IPv4", internal: false }],
  };

  assert.throws(() => selectLanAddress(networks), /несколько сетевых адресов/);
});

test("не использует virtual adapter без явного --ip", () => {
  const networks = {
    "vEthernet (DockerNAT)": [
      { address: "172.20.0.1", family: "IPv4", internal: false },
    ],
  };

  assert.throws(() => selectLanAddress(networks), /физический private IPv4/);
});

test("генерирует согласованную LAN-конфигурацию", () => {
  assert.equal(
    renderLanEnv("192.168.1.146"),
    `# Сгенерировано командой pnpm infra:lan:setup. Только для приватной домашней сети.\n# Не используйте с публичным IP, port forwarding, VPN exit node или cloud VM.\n\nGATEWAY_BIND_ADDRESS=0.0.0.0\nLIVEKIT_BIND_ADDRESS=0.0.0.0\nLIVEKIT_NODE_IP=192.168.1.146\nLIVEKIT_URL=ws://192.168.1.146:7880\nLIVEKIT_URL_FROM_REQUEST=true\nPUBLIC_LIVEKIT_URL=ws://192.168.1.146:7880\n`,
  );
});

test("сохраняет дополнительные пользовательские переменные при обновлении LAN IP", () => {
  const source = "APP_PORT=9000\nLIVEKIT_NODE_IP=192.168.1.42\n# сохранить\n";

  assert.equal(
    updateLanEnv(source, "192.168.1.146"),
    "APP_PORT=9000\nLIVEKIT_NODE_IP=192.168.1.146\n# сохранить\nGATEWAY_BIND_ADDRESS=0.0.0.0\nLIVEKIT_BIND_ADDRESS=0.0.0.0\nLIVEKIT_URL=ws://192.168.1.146:7880\nLIVEKIT_URL_FROM_REQUEST=true\nPUBLIC_LIVEKIT_URL=ws://192.168.1.146:7880\n",
  );
});
