import {
  INVITE_SHARE_TEXT,
  createRoomInviteUrl,
  toPublicRoomInviteUrl,
  toTelegramShareUrl,
} from "./share-invite";

const roomId = "AbCdEfGhIjKlMnOpQrStUv";

describe("share invite URLs", () => {
  it("оставляет только публичный room route", () => {
    expect(
      toPublicRoomInviteUrl(
        `https://review.example/rooms/${roomId}?hostSecret=secret&livekitToken=token#telemetry`,
      ),
    ).toBe(`https://review.example/rooms/${roomId}`);
  });

  it("не создаёт share URL для невалидного пути или схемы", () => {
    expect(toPublicRoomInviteUrl("https://review.example/operator?token=secret")).toBeNull();
    expect(toPublicRoomInviteUrl(`javascript:alert('/rooms/${roomId}')`)).toBeNull();
  });

  it("строит Telegram URL только из публичной ссылки комнаты", () => {
    const telegramUrl = toTelegramShareUrl(
      `https://review.example/rooms/${roomId}?hostSecret=secret&media=private.mp4`,
    );

    expect(telegramUrl).not.toBeNull();
    const parsedUrl = new URL(telegramUrl ?? "");
    expect(parsedUrl.origin).toBe("https://t.me");
    expect(parsedUrl.pathname).toBe("/share/url");
    expect(parsedUrl.searchParams.get("url")).toBe(`https://review.example/rooms/${roomId}`);
    expect(parsedUrl.searchParams.get("text")).toBe(INVITE_SHARE_TEXT);
    expect(telegramUrl).not.toContain("hostSecret");
    expect(telegramUrl).not.toContain("private.mp4");
  });

  it("создаёт canonical invite для mobile handoff", () => {
    expect(createRoomInviteUrl(roomId, "https://review.example")).toBe(
      `https://review.example/rooms/${roomId}`,
    );
  });
});
