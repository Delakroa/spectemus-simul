import { describe, expect, it } from "vitest";

import { closedInternetRoomRefusal } from "./room-mode";

describe("room mode", () => {
  it("отказывает в закрытом Internet mode без LAN-запроса", () => {
    expect(closedInternetRoomRefusal()).toEqual({
      message:
        "Просмотр из другого города сейчас закрыт. Локальная комната вместо него не создаётся.",
      requestsLanRoom: false,
      title: "Комната через интернет недоступна",
    });
  });
});
