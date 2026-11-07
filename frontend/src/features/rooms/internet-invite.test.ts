import { describe, expect, it } from "vitest";

import { readInternetInviteToken, recognizeInternetInviteHash } from "./internet-invite";

const token = "a".repeat(43);

describe("internet invite hash", () => {
  it("распознаёт fragment invite и не возвращает сам token", () => {
    expect(recognizeInternetInviteHash(`#invite=${token}`)).toBe("present");
    expect(JSON.stringify(recognizeInternetInviteHash(`#invite=${token}`))).not.toContain(token);
  });

  it("читает raw token только для in-memory redemption", () => {
    expect(readInternetInviteToken(`#invite=${token}`)).toBe(token);
    expect(readInternetInviteToken("#invite=short")).toBeNull();
    expect(readInternetInviteToken("")).toBeNull();
  });

  it("отличает пустую и повреждённую ссылку", () => {
    expect(recognizeInternetInviteHash("")).toBe("missing");
    expect(recognizeInternetInviteHash("#room=1")).toBe("missing");
    expect(recognizeInternetInviteHash("#invite=short")).toBe("invalid");
    expect(recognizeInternetInviteHash(`#invite=${token}&extra=1`)).toBe("present");
  });
});
