import { ApiProblemError } from "../rooms/room-api";
import { submitTelemetry } from "./telemetry-api";

const ROOM_ID = "AbCdEfGhIjKlMnOpQrStUv";

describe("telemetry api", () => {
  it("отправляет батч telemetry и валидирует receipt", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          telemetryId: "a1b2c3d4-1111-4222-8333-444455556666",
          correlationId: "22222222-2222-4222-8222-222222222222",
          receivedAt: "2026-07-12T12:00:00Z",
          accepted: 1,
        }),
        { status: 202 },
      ),
    );

    await expect(
      submitTelemetry({
        events: [{ type: "FIRST_FRAME", roomId: ROOM_ID, role: "GUEST" }],
      }),
    ).resolves.toMatchObject({ accepted: 1 });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/telemetry",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
        body: expect.stringContaining('"type":"FIRST_FRAME"'),
      }),
    );
  });

  it("сохраняет problem details из backend-ошибки", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          title: "Validation failed",
          status: 422,
          code: "VALIDATION_FAILED",
          detail: "events не может быть пустым",
          correlationId: "22222222-2222-4222-8222-222222222222",
          retryable: false,
        }),
        { status: 422 },
      ),
    );

    await expect(
      submitTelemetry({ events: [{ type: "QUALITY_SUMMARY", qualityStatus: "GOOD" }] }),
    ).rejects.toMatchObject({
      name: "ApiProblemError",
      problem: {
        code: "VALIDATION_FAILED",
        status: 422,
      },
    } satisfies Partial<ApiProblemError>);
  });
});
