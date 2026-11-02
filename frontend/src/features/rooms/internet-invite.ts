const INTERNET_INVITE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export type InternetInviteRecognition = "missing" | "invalid" | "present";

export function recognizeInternetInviteHash(hash: string): InternetInviteRecognition {
  const normalized = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!normalized) {
    return "missing";
  }

  const params = new URLSearchParams(normalized);
  if (!params.has("invite")) {
    return "missing";
  }

  const token = params.get("invite");
  if (!token || !INTERNET_INVITE_TOKEN.test(token)) {
    return "invalid";
  }

  return "present";
}
