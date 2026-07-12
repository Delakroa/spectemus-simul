import { expect, type BrowserContext, type Page } from "@playwright/test";

const ROOM_STATE_HEADING = "Состояние комнаты";

export async function createRoom(
  page: Page,
  hostName: string,
): Promise<string> {
  await page.goto("/");
  await page.getByLabel("Имя host").fill(hostName);
  await page.getByRole("button", { name: "Создать" }).click();

  await expect(
    page.getByRole("heading", { name: ROOM_STATE_HEADING }),
  ).toBeVisible();
  const roomId = (
    await page.locator(".room-copy-field code").first().textContent()
  )?.trim();
  if (!roomId) {
    throw new Error("Room id was not rendered after creating the room");
  }
  return roomId;
}

export async function joinRoom(
  page: Page,
  roomId: string,
  guestName: string,
): Promise<void> {
  await submitJoinRoom(page, roomId, guestName);

  await expect(
    page.getByRole("heading", { name: ROOM_STATE_HEADING }),
  ).toBeVisible();
}

export async function submitJoinRoom(
  page: Page,
  roomId: string,
  guestName: string,
): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Invite-ссылка или ID комнаты").fill(roomId);
  await page.getByLabel("Имя гостя").fill(guestName);
  await page.getByRole("button", { name: "Войти" }).click();
}

export async function sendChat(page: Page, text: string): Promise<void> {
  await page.getByLabel("Сообщение в чат").fill(text);
  await page.getByRole("button", { name: "Отправить" }).click();
}

export async function expectRoomSocketOpen(page: Page): Promise<void> {
  await expect(page.locator(".room-connection--open").first()).toContainText(
    "live",
  );
}

export async function expectRoomSocketReconnecting(page: Page): Promise<void> {
  await expect(
    page.locator(".room-connection--reconnecting").first(),
  ).toContainText("переподключение", { timeout: 30_000 });
}

export async function closeContexts(
  ...contexts: BrowserContext[]
): Promise<void> {
  await Promise.all(contexts.map((context) => context.close()));
}
