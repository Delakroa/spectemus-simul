const VIRTUAL_INTERFACE = /(?:docker|veth|vmnet|virtual|wsl|loopback|bridge)/i;

export function isPrivateIpv4(value) {
  if (typeof value !== "string") {
    return false;
  }

  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
    return false;
  }

  const octets = parts.map((part) => Number(part));
  if (
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

export function collectLanAddresses(networks) {
  return Object.entries(networks)
    .flatMap(([interfaceName, addresses]) =>
      (addresses ?? []).map((address) => ({ interfaceName, ...address })),
    )
    .filter(
      (address) =>
        address.family === "IPv4" &&
        !address.internal &&
        isPrivateIpv4(address.address),
    )
    .map(({ interfaceName, address }) => ({
      address,
      interfaceName,
      virtual: VIRTUAL_INTERFACE.test(interfaceName),
    }));
}

export function selectLanAddress(networks) {
  const candidates = collectLanAddresses(networks);
  const physicalCandidates = candidates.filter(
    (candidate) => !candidate.virtual,
  );
  const uniqueAddresses = [
    ...new Map(physicalCandidates.map((item) => [item.address, item])).values(),
  ];

  if (uniqueAddresses.length === 1) {
    return uniqueAddresses[0];
  }

  const description = candidates
    .map((candidate) => `${candidate.interfaceName}: ${candidate.address}`)
    .join(", ");

  if (uniqueAddresses.length === 0) {
    throw new Error(
      "Не найден физический private IPv4. Подключите host к домашней сети или передайте --ip <IPv4>.",
    );
  }

  throw new Error(
    `Найдено несколько сетевых адресов (${description}). Выберите адрес домашней сети: pnpm infra:lan:setup -- --ip <IPv4>.`,
  );
}

export function renderLanEnv(hostIp) {
  if (!isPrivateIpv4(hostIp)) {
    throw new Error(
      "Для LAN нужен private IPv4 из диапазона 10.x.x.x, 172.16-31.x.x или 192.168.x.x.",
    );
  }

  return `# Сгенерировано командой pnpm infra:lan:setup. Только для приватной домашней сети.\n# Не используйте с публичным IP, port forwarding, VPN exit node или cloud VM.\n\nGATEWAY_BIND_ADDRESS=0.0.0.0\nLIVEKIT_BIND_ADDRESS=0.0.0.0\nLIVEKIT_NODE_IP=${hostIp}\nLIVEKIT_URL=ws://${hostIp}:7880\nLIVEKIT_URL_FROM_REQUEST=true\nPUBLIC_LIVEKIT_URL=ws://${hostIp}:7880\n`;
}

export function updateLanEnv(source, hostIp) {
  if (!isPrivateIpv4(hostIp)) {
    throw new Error(
      "Для LAN нужен private IPv4 из диапазона 10.x.x.x, 172.16-31.x.x или 192.168.x.x.",
    );
  }

  if (!source) {
    return renderLanEnv(hostIp);
  }

  const values = {
    GATEWAY_BIND_ADDRESS: "0.0.0.0",
    LIVEKIT_BIND_ADDRESS: "0.0.0.0",
    LIVEKIT_NODE_IP: hostIp,
    LIVEKIT_URL: `ws://${hostIp}:7880`,
    LIVEKIT_URL_FROM_REQUEST: "true",
    PUBLIC_LIVEKIT_URL: `ws://${hostIp}:7880`,
  };
  const updated = new Set();
  const lines = source.split(/\r?\n/).map((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    const key = match?.[1];

    if (!key || !(key in values)) {
      return line;
    }

    updated.add(key);
    return `${key}=${values[key]}`;
  });
  const missing = Object.entries(values)
    .filter(([key]) => !updated.has(key))
    .map(([key, value]) => `${key}=${value}`);
  const preserved = lines.join("\n").replace(/\n+$/, "");

  return `${preserved}\n${missing.join("\n")}\n`;
}
