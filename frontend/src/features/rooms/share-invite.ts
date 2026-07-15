const ROOM_INVITE_PATH = /^\/rooms\/[A-Za-z0-9_-]{22}$/;

export const INVITE_SHARE_TITLE = "Приглашение в приватную комнату";
export const INVITE_SHARE_TEXT =
  "Откройте приглашение на компьютере, чтобы присоединиться к просмотру.";

/**
 * Keeps every share surface on the public room route. Runtime state may contain
 * host, operator or media-plane credentials, so query, hash and credentials are
 * deliberately never propagated into an invitation.
 */
export function toPublicRoomInviteUrl(inviteUrl: string | null | undefined) {
  if (!inviteUrl) {
    return null;
  }

  try {
    const parsedUrl = new URL(inviteUrl);
    if (
      (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") ||
      !ROOM_INVITE_PATH.test(parsedUrl.pathname)
    ) {
      return null;
    }

    return new URL(parsedUrl.pathname, parsedUrl.origin).toString();
  } catch {
    return null;
  }
}

export function createRoomInviteUrl(roomId: string, origin = window.location.origin) {
  return toPublicRoomInviteUrl(new URL(`/rooms/${roomId}`, origin).toString());
}

export function toTelegramShareUrl(inviteUrl: string | null | undefined) {
  const publicInviteUrl = toPublicRoomInviteUrl(inviteUrl);
  if (!publicInviteUrl) {
    return null;
  }

  const telegramUrl = new URL("https://t.me/share/url");
  telegramUrl.searchParams.set("url", publicInviteUrl);
  telegramUrl.searchParams.set("text", INVITE_SHARE_TEXT);
  return telegramUrl.toString();
}
