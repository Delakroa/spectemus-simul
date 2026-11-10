export function getInternetAppOrigin(): string | null {
  const configured = import.meta.env.VITE_INTERNET_APP_ORIGIN?.trim();
  if (!configured) {
    return null;
  }

  try {
    const url = new URL(configured);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !isPublicHostname(url.hostname) ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

function isPublicHostname(rawHostname: string) {
  const hostname = rawHostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    hostname.includes(":")
  ) {
    return false;
  }

  const octets = hostname.split(".").map(Number);
  if (octets.length === 4 && octets.every((octet) => Number.isInteger(octet))) {
    return false;
  }

  return true;
}

export function createInternetInviteUrl(origin: string, invitePath: string) {
  return new URL(invitePath, `${origin}/`).toString();
}
