const INTERNET_INVITE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export type InternetInviteRecognition = "missing" | "invalid" | "present";

export function recognizeInternetInviteHash(hash: string): InternetInviteRecognition {
  const token = readInternetInviteToken(hash);
  if (token) {
    return "present";
  }

  const normalized = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!normalized) {
    return "missing";
  }

  const params = new URLSearchParams(normalized);
  if (!params.has("invite")) {
    return "missing";
  }

  return "invalid";
}

/** Raw invite token stays in memory only. Never render, log or persist it. */
export function readInternetInviteToken(hash: string): string | null {
  const normalized = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!normalized) {
    return null;
  }

  const params = new URLSearchParams(normalized);
  const token = params.get("invite");
  if (!token || !INTERNET_INVITE_TOKEN.test(token)) {
    return null;
  }

  return token;
}
