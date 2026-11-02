export type RoomProductMode = "lan" | "internet";

export const CLOSED_INTERNET_ROOM_TITLE = "Комната через интернет недоступна";
export const CLOSED_INTERNET_ROOM_MESSAGE =
  "Просмотр из другого города сейчас закрыт. Локальная комната вместо него не создаётся.";

export function isInternetRoomChoiceEnabled() {
  return import.meta.env.VITE_INTERNET_ROOM_RUNTIME_ENABLED === "true";
}

/** Closed Internet choice stays in the browser. It must not call LAN `/api/v1`. */
export function closedInternetRoomRefusal() {
  return {
    message: CLOSED_INTERNET_ROOM_MESSAGE,
    requestsLanRoom: false as const,
    title: CLOSED_INTERNET_ROOM_TITLE,
  };
}
