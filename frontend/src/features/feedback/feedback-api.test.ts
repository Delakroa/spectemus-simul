import { ApiProblemError } from "../rooms/room-api";
import { submitFeedback } from "./feedback-api";

const roomId = "AbCdEfGhIjKlMnOpQrStUv";

describe("feedback api", () => {
  it("отправляет beta feedback и валидирует receipt", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          feedbackId: "f4b1dc2a-28e1-4490-88cf-3a6f5aefef43",
          correlationId: "22222222-2222-4222-8222-222222222222",
          receivedAt: "2026-07-12T12:00:00Z",
        }),
        { status: 202 },
      ),
    );

    await expect(
      submitFeedback({
        outcome: "ISSUE",
        reason: "CONNECTION",
        message: "Гость потерял звук после reconnect.",
        roomId,
        participantRole: "HOST",
        relatedCorrelationId: "11111111-1111-4111-8111-111111111111",
        metadata: {
          language: "ru-RU",
          liveKitStatus: "connected",
          networkEffectiveType: "4g",
          participantCount: 2,
        },
      }),
    ).resolves.toMatchObject({
      feedbackId: "f4b1dc2a-28e1-4490-88cf-3a6f5aefef43",
      correlationId: "22222222-2222-4222-8222-222222222222",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/feedback",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
        body: expect.stringContaining('"reason":"CONNECTION"'),
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
          detail: "reason обязателен",
          correlationId: "22222222-2222-4222-8222-222222222222",
          retryable: false,
        }),
        { status: 422 },
      ),
    );

    await expect(submitFeedback({ outcome: "ISSUE", reason: "OTHER" })).rejects.toMatchObject({
      message: "reason обязателен",
      name: "ApiProblemError",
      problem: {
        code: "VALIDATION_FAILED",
        correlationId: "22222222-2222-4222-8222-222222222222",
        retryable: false,
        status: 422,
      },
    } satisfies Partial<ApiProblemError>);
  });
});
