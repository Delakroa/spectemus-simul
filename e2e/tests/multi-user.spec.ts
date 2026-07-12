import { expect, test } from "@playwright/test";

import {
  closeContexts,
  createRoom,
  joinRoom,
  sendChat,
} from "./support/room-flow";

test("host and two guests: presence and chat propagate across all clients", async ({
  browser,
}) => {
  // Separate contexts model three independent browsers (independent session cookies).
  const hostContext = await browser.newContext();
  const guestOneContext = await browser.newContext();
  const guestTwoContext = await browser.newContext();

  try {
    const host = await hostContext.newPage();
    const guestOne = await guestOneContext.newPage();
    const guestTwo = await guestTwoContext.newPage();

    const roomId = await createRoom(host, "Host");
    await joinRoom(guestOne, roomId, "Guest One");
    await joinRoom(guestTwo, roomId, "Guest Two");

    // Presence fan-out: every client converges on three participants.
    for (const page of [host, guestOne, guestTwo]) {
      await expect(page.getByText("3/4")).toBeVisible();
    }

    // A guest message reaches the host and the other guest (and echoes to the sender).
    await sendChat(guestOne, "Привет от гостя");
    for (const page of [host, guestTwo, guestOne]) {
      await expect(page.getByText("Привет от гостя")).toBeVisible();
    }

    // The host reply reaches both guests.
    await sendChat(host, "Привет от хоста");
    for (const page of [guestOne, guestTwo]) {
      await expect(page.getByText("Привет от хоста")).toBeVisible();
    }
  } finally {
    await closeContexts(hostContext, guestOneContext, guestTwoContext);
  }
});
