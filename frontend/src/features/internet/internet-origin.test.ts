import { afterEach, describe, expect, it, vi } from "vitest";

import { createInternetInviteUrl, getInternetAppOrigin } from "./internet-origin";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("internet app origin", () => {
  it("принимает только public HTTPS origin", () => {
    vi.stubEnv("VITE_INTERNET_APP_ORIGIN", "https://app.example.test/");
    expect(getInternetAppOrigin()).toBe("https://app.example.test");

    vi.stubEnv("VITE_INTERNET_APP_ORIGIN", "http://127.0.0.1:8088");
    expect(getInternetAppOrigin()).toBeNull();

    vi.stubEnv("VITE_INTERNET_APP_ORIGIN", "https://192.168.1.42");
    expect(getInternetAppOrigin()).toBeNull();

    vi.stubEnv("VITE_INTERNET_APP_ORIGIN", "https://203.0.113.10");
    expect(getInternetAppOrigin()).toBeNull();

    vi.stubEnv("VITE_INTERNET_APP_ORIGIN", "https://[::1]");
    expect(getInternetAppOrigin()).toBeNull();

    vi.stubEnv("VITE_INTERNET_APP_ORIGIN", "https://app.example.test/path");
    expect(getInternetAppOrigin()).toBeNull();
  });

  it("собирает hash-only invite на public origin", () => {
    expect(
      createInternetInviteUrl("https://app.example.test", `/join#invite=${"a".repeat(43)}`),
    ).toBe(`https://app.example.test/join#invite=${"a".repeat(43)}`);
  });
});
