import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OperatorDashboardPage } from "./OperatorDashboardPage";

const token = "operator-secret";
const feedbackId = "f4b1dc2a-28e1-4490-88cf-3a6f5aefef43";

const listResponse = {
  count: 2,
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
    {
      feedbackId: "cf9fd504-3b79-4f1d-8c57-45b7af15f9d5",
      correlationId: "http-correlation-2",
      receivedAt: "2026-07-13T07:45:00Z",
      outcome: "WORKED",
      reason: "SUCCESS",
      roomId: "AbCdEfGhIjKlMnOpQrStUv",
      participantRole: "HOST",
      triageStatus: "RESOLVED",
      severity: "LOW",
      messagePreview: "Сессия прошла хорошо.",
    },
  ],
};

const reportDetail = {
  ...listResponse.reports[0],
  message: "Полный комментарий про синхронизацию.",
  metadata: {
    language: "ru-RU",
    liveKitStatus: "connected",
    networkEffectiveType: "4g",
    participantCount: 2,
    qualityStatus: "warning",
  },
};

function deferred<T>() {
  let resolve: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve: resolve! };
}

describe("OperatorDashboardPage", () => {
  afterEach(() => {
    cleanup();
    globalThis.localStorage?.removeItem?.("watchTogether.operatorToken");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("загружает reports по token, открывает детали и обновляет triage", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);

      if (url.endsWith("/api/v1/feedback/reports?limit=100")) {
        return new Response(JSON.stringify(listResponse), { status: 200 });
      }

      if (url.endsWith(`/api/v1/feedback/reports/${feedbackId}`) && init?.method === "PATCH") {
        return new Response(
          JSON.stringify({
            ...reportDetail,
            assignee: "beta-ops",
            severity: "BLOCKER",
            triageNote: "Marked from operator dashboard",
            triageStatus: "REVIEWING",
            triagedAt: "2026-07-13T08:01:00Z",
          }),
          { status: 200 },
        );
      }

      if (url.endsWith(`/api/v1/feedback/reports/${feedbackId}`)) {
        return new Response(JSON.stringify(reportDetail), { status: 200 });
      }

      return new Response("not found", { status: 404 });
    });

    render(<OperatorDashboardPage />);

    await user.type(screen.getByLabelText("Admin token"), token);
    await user.click(screen.getByRole("button", { name: "Подключить" }));

    expect(await screen.findByText("Гость увидел рассинхрон.")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/feedback/reports?limit=100",
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-Feedback-Admin-Token": token,
          }),
        }),
      );
    });

    await user.click(screen.getByRole("button", { name: /Открыть отзыв f4b1dc2a/ }));
    expect(await screen.findByText("Полный комментарий про синхронизацию.")).toBeInTheDocument();
    expect(screen.getByText(/"liveKitStatus": "connected"/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Blocker" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Triage обновлён: В работе");
    const patchCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith(`/api/v1/feedback/reports/${feedbackId}`) &&
        init?.method === "PATCH",
    );

    expect(JSON.parse(patchCall?.[1]?.body as string)).toMatchObject({
      assignee: "beta-ops",
      note: "Marked from operator dashboard",
      severity: "BLOCKER",
      status: "REVIEWING",
    });
  });

  it("не восстанавливает список из завершившегося после сброса запроса", async () => {
    const user = userEvent.setup();
    const listRequest = deferred<Response>();
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      if (String(input).endsWith("/api/v1/feedback/reports?limit=100")) {
        return listRequest.promise;
      }

      return Promise.resolve(new Response("not found", { status: 404 }));
    });

    render(<OperatorDashboardPage />);

    await user.type(screen.getByLabelText("Admin token"), token);
    await user.click(screen.getByRole("button", { name: "Подключить" }));
    await user.click(screen.getByRole("button", { name: "Сбросить" }));
    listRequest.resolve(new Response(JSON.stringify(listResponse), { status: 200 }));

    await waitFor(() => {
      expect(screen.getByText("Укажите operator token для чтения reports.")).toBeInTheDocument();
    });
    expect(screen.queryByText("Гость увидел рассинхрон.")).not.toBeInTheDocument();
  });

  it("не заменяет выбранный report деталями от устаревшего запроса", async () => {
    const user = userEvent.setup();
    const secondReport = {
      ...listResponse.reports[1],
      triageStatus: "NEW" as const,
    };
    const reportsResponse = {
      ...listResponse,
      reports: [listResponse.reports[0], secondReport],
    };
    const firstDetailRequest = deferred<Response>();
    const secondDetailRequest = deferred<Response>();

    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/api/v1/feedback/reports?limit=100")) {
        return Promise.resolve(new Response(JSON.stringify(reportsResponse), { status: 200 }));
      }
      if (url.endsWith(`/api/v1/feedback/reports/${feedbackId}`)) {
        return firstDetailRequest.promise;
      }
      if (url.endsWith(`/api/v1/feedback/reports/${secondReport.feedbackId}`)) {
        return secondDetailRequest.promise;
      }

      return Promise.resolve(new Response("not found", { status: 404 }));
    });

    render(<OperatorDashboardPage />);

    await user.type(screen.getByLabelText("Admin token"), token);
    await user.click(screen.getByRole("button", { name: "Подключить" }));
    expect(await screen.findByText("Сессия прошла хорошо.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Открыть отзыв f4b1dc2a/ }));
    await user.click(
      screen.getByRole("button", { name: `Открыть отзыв ${secondReport.feedbackId.slice(0, 8)}` }),
    );
    secondDetailRequest.resolve(
      new Response(
        JSON.stringify({
          ...secondReport,
          message: "Второй полный комментарий.",
        }),
        { status: 200 },
      ),
    );

    expect(await screen.findByText("Второй полный комментарий.")).toBeInTheDocument();
    firstDetailRequest.resolve(new Response(JSON.stringify(reportDetail), { status: 200 }));

    await waitFor(() => {
      expect(screen.getByText("Второй полный комментарий.")).toBeInTheDocument();
    });
    expect(screen.queryByText("Полный комментарий про синхронизацию.")).not.toBeInTheDocument();
  });

  it("не показывает детали, полученные после сброса token", async () => {
    const user = userEvent.setup();
    const detailRequest = deferred<Response>();

    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/api/v1/feedback/reports?limit=100")) {
        return Promise.resolve(new Response(JSON.stringify(listResponse), { status: 200 }));
      }
      if (url.endsWith(`/api/v1/feedback/reports/${feedbackId}`)) {
        return detailRequest.promise;
      }

      return Promise.resolve(new Response("not found", { status: 404 }));
    });

    render(<OperatorDashboardPage />);

    await user.type(screen.getByLabelText("Admin token"), token);
    await user.click(screen.getByRole("button", { name: "Подключить" }));
    await user.click(screen.getByRole("button", { name: /Открыть отзыв f4b1dc2a/ }));
    await user.click(screen.getByRole("button", { name: "Сбросить" }));
    detailRequest.resolve(new Response(JSON.stringify(reportDetail), { status: 200 }));

    await waitFor(() => {
      expect(screen.getByText("Отчёт не выбран")).toBeInTheDocument();
    });
    expect(screen.queryByText("Полный комментарий про синхронизацию.")).not.toBeInTheDocument();
  });

  it("скачивает экспорт reports как JSON", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => "blob:operator-export");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/api/v1/feedback/reports?limit=100")) {
        return Promise.resolve(new Response(JSON.stringify(listResponse), { status: 200 }));
      }
      if (url.endsWith("/api/v1/feedback/reports/export?limit=200")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              count: 2,
              exportedAt: "2026-07-13T08:02:00Z",
              reports: [
                reportDetail,
                {
                  ...listResponse.reports[1],
                  message: "Полный комментарий об успешной сессии.",
                },
              ],
            }),
            { status: 200 },
          ),
        );
      }

      return Promise.resolve(new Response("not found", { status: 404 }));
    });

    render(<OperatorDashboardPage />);

    await user.type(screen.getByLabelText("Admin token"), token);
    await user.click(screen.getByRole("button", { name: "Подключить" }));
    await user.click(screen.getByRole("button", { name: "Экспорт" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Экспортировано reports: 2");
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(anchorClick).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:operator-export");
    });
  });
});
