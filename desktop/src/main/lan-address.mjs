import { networkInterfaces } from "node:os";

const VIRTUAL_INTERFACE = /(?:docker|veth|vmnet|virtual|wsl|loopback|bridge)/i;

export class LanAddressSelectionRequired extends Error {
  constructor(candidates) {
    super("Выберите private IPv4 домашней сети для desktop host.");
    this.candidates = candidates;
  }
}

export function isPrivateIpv4(value) {
  if (typeof value !== "string") {
    return false;
  }

  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
    return false;
  }

  const octets = parts.map(Number);
  if (octets.some((part) => part < 0 || part > 255)) {
    return false;
  }

  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

export function collectLanAddresses(networks = networkInterfaces()) {
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

export function resolveLanAddress(networks, preferredIp) {
  const candidates = collectLanAddresses(networks);
  const physical = [
    ...new Map(
      candidates
        .filter((candidate) => !candidate.virtual)
        .map((candidate) => [candidate.address, candidate]),
    ).values(),
  ];

  if (preferredIp) {
    if (!isPrivateIpv4(preferredIp)) {
      throw new Error(
        "Для desktop host разрешён только private IPv4 домашней сети.",
      );
    }
    const selected = physical.find(
      (candidate) => candidate.address === preferredIp,
    );
    if (!selected) {
      throw new Error(
        "Указанный SPECTEMUS_LAN_IP не найден среди физических сетевых адресов.",
      );
    }
    return selected;
  }

  if (physical.length === 1) {
    return physical[0];
  }
  if (physical.length === 0) {
    throw new Error(
      "Не найден физический private IPv4. Подключите host к домашней сети.",
    );
  }

  throw new LanAddressSelectionRequired(physical);
}
