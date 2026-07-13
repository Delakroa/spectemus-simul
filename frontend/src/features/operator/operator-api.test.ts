import { ApiProblemError } from "../rooms/room-api";
import { listFeedbackReports, updateFeedbackReportTriage } from "./operator-api";

const token = "operator-secret";
const feedbackId = "f4b1dc2a-28e1-4490-88cf-3a6f5aefef43";

describe("operator api", () => {
  it("загружает feedback reports с operator token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          count: 1,
          listedAt: "2026-07-13T08:00:00Z",
          reports: [
            {
              feedbackId,
              correlationId: "http-correlation-1",
              receivedAt: "2026-07-13T07:55:00Z",
              outcome: "ISSUE",
              reason: "SYNC",
              roomId: "AbCdEfGhIjKlMnOpQrStUv",
              participantRole: "GUEST",
              triageStatus: "NEW",
              severity: "UNSET",
              messagePreview: "Гость увидел рассинхрон.",
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(listFeedbackReports(token, 25)).resolves.toMatchObject({
      count: 1,
      reports: [
        {
          feedbackId,
          reason: "SYNC",
          triageStatus: "NEW",
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/feedback/reports?limit=25",
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({
          Accept: "application/json",
          "X-Feedback-Admin-Token": token,
        }),
        method: "GET",
      }),
    );
  });

  it("обновляет triage report", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          feedbackId,
          correlationId: "http-correlation-1",
          receivedAt: "2026-07-13T07:55:00Z",
          outcome: "BLOCKED",
          reason: "CONNECTION",
          message: "Guest lost playback after reconnect.",
          roomId: "AbCdEfGhIjKlMnOpQrStUv",
          participantRole: "HOST",
          triageStatus: "REVIEWING",
          severity: "BLOCKER",
          assignee: "beta-ops",
          triageNote: "Marked from operator dashboard",
          triagedAt: "2026-07-13T08:01:00Z",
        }),
        { status: 200 },
      ),
    );

    await expect(
      updateFeedbackReportTriage(token, feedbackId, {
        assignee: "beta-ops",
        note: "Marked from operator dashboard",
        severity: "BLOCKER",
        status: "REVIEWING",
      }),
    ).resolves.toMatchObject({
      feedbackId,
      severity: "BLOCKER",
      triageStatus: "REVIEWING",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/feedback/reports/${feedbackId}`,
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Feedback-Admin-Token": token,
        }),
        method: "PATCH",
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      assignee: "beta-ops",
      note: "Marked from operator dashboard",
      severity: "BLOCKER",
      status: "REVIEWING",
    });
  });

  it("возвращает problem details при неверном operator token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "FEEDBACK_ADMIN_FORBIDDEN",
          detail: "Передайте корректный X-Feedback-Admin-Token.",
          retryable: false,
          status: 403,
          title: "Доступ запрещён",
        }),
        { status: 403 },
      ),
    );

    await expect(listFeedbackReports("bad-token")).rejects.toMatchObject({
      name: "ApiProblemError",
      problem: {
        code: "FEEDBACK_ADMIN_FORBIDDEN",
        status: 403,
      },
    } satisfies Partial<ApiProblemError>);
  });
});
