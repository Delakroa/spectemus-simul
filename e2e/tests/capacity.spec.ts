import { expect, test, type Page } from "@playwright/test";

import {
  closeContexts,
  createRoom,
  joinRoom,
  sendChat,
  submitJoinRoom,
} from "./support/room-flow";

test("room capacity: host plus three guests stay usable and the next guest is rejected", async ({
  browser,
}) => {
  test.slow();

  const hostContext = await browser.newContext();
  const guestOneContext = await browser.newContext();
  const guestTwoContext = await browser.newContext();
  const guestThreeContext = await browser.newContext();
  const overflowGuestContext = await browser.newContext();

  try {
    const host = await hostContext.newPage();
    const guestOne = await guestOneContext.newPage();
    const guestTwo = await guestTwoContext.newPage();
    const guestThree = await guestThreeContext.newPage();
    const overflowGuest = await overflowGuestContext.newPage();

    const roomId = await createRoom(host, "Host");

    await joinRoom(guestOne, roomId, "Guest One");
    await expectParticipantCounter([host, guestOne], "2/4");

    await joinRoom(guestTwo, roomId, "Guest Two");
    await expectParticipantCounter([host, guestOne, guestTwo], "3/4");

    await joinRoom(guestThree, roomId, "Guest Three");
    await expectParticipantCounter(
      [host, guestOne, guestTwo, guestThree],
      "4/4",
    );

    await sendChat(host, "capacity host ping");
    for (const page of [guestOne, guestTwo, guestThree]) {
      await expect(page.getByText("capacity host ping")).toBeVisible();
    }

    await sendChat(guestThree, "capacity guest ping");
    for (const page of [host, guestOne, guestTwo]) {
      await expect(page.getByText("capacity guest ping")).toBeVisible();
    }

    await submitJoinRoom(overflowGuest, roomId, "Guest Four");
    await expect(overflowGuest.getByRole("alert")).toContainText(
      "В комнате уже находится максимально допустимое число участников.",
    );
    await expect(
      overflowGuest.getByRole("heading", { name: /^Комната / }),
    ).toHaveCount(0);

    await expectParticipantCounter(
      [host, guestOne, guestTwo, guestThree],
      "4/4",
    );
  } finally {
    await closeContexts(
      hostContext,
      guestOneContext,
      guestTwoContext,
      guestThreeContext,
      overflowGuestContext,
    );
  }
});

async function expectParticipantCounter(pages: Page[], value: string) {
  for (const page of pages) {
    await expect(page.getByText(value)).toBeVisible();
  }
}
