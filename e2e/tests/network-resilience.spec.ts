import { expect, test } from "@playwright/test";

import {
  closeContexts,
  createRoom,
  expectRoomSocketOpen,
  expectRoomSocketReconnecting,
  joinRoom,
  sendChat,
} from "./support/room-flow";

test("guest browser recovers room WebSocket after offline window", async ({
  browser,
}) => {
  test.slow();

  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();

  try {
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();

    const roomId = await createRoom(host, "Host");
    await joinRoom(guest, roomId, "Guest");

    await expectRoomSocketOpen(host);
    await expectRoomSocketOpen(guest);

    await sendChat(guest, "before offline");
    await expect(host.getByText("before offline")).toBeVisible();

    await guestContext.setOffline(true);
    // Chromium's network emulation does not always dispatch the standard browser
    // event for already-open WebSockets. The app uses that signal to start the
    // same reconnect path a real browser takes on a network outage.
    await guest.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expectRoomSocketReconnecting(guest);

    await guestContext.setOffline(false);
    await expectRoomSocketOpen(guest);

    await sendChat(guest, "after reconnect");
    await expect(host.getByText("after reconnect")).toBeVisible();
  } finally {
    await guestContext.setOffline(false).catch(() => undefined);
    await closeContexts(hostContext, guestContext);
  }
});
