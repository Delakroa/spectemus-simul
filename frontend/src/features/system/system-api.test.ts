import { getSystemHealth, getSystemVersion } from "./system-api";

describe("system api", () => {
  it("валидирует health-ответ", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "UP",
          checkedAt: "2026-07-08T16:30:00Z",
        }),
        { status: 200 },
      ),
    );

    await expect(getSystemHealth()).resolves.toEqual({
      status: "UP",
      checkedAt: "2026-07-08T16:30:00Z",
    });
  });

  it("отклоняет некорректный version-ответ", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          name: "watch-together-backend",
          version: "",
          buildTime: "unknown",
          apiVersion: "v1",
        }),
        { status: 200 },
      ),
    );

    await expect(getSystemVersion()).rejects.toThrow();
  });

  it("сообщает об HTTP-ошибке", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));

    await expect(getSystemHealth()).rejects.toThrow("Backend вернул HTTP 503");
  });
});
