import { AlertTriangle, CheckCircle2, Download, Eye, RefreshCw, ShieldCheck } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import type { FeedbackOutcome, FeedbackReason } from "../features/feedback/feedback-api";
import {
  exportFeedbackReports,
  getFeedbackReport,
  listFeedbackReports,
  updateFeedbackReportTriage,
  type FeedbackReport,
  type FeedbackReportSummary,
  type FeedbackSeverity,
  type FeedbackTriageStatus,
} from "../features/operator/operator-api";
import { ApiProblemError } from "../features/rooms/room-api";

const operatorTokenStorageKey = "watchTogether.operatorToken";

const statusFilters = [
  { label: "Открытые", value: "OPEN" },
  { label: "Все", value: "ALL" },
  { label: "Новые", value: "NEW" },
  { label: "В работе", value: "REVIEWING" },
  { label: "Решены", value: "RESOLVED" },
  { label: "Игнор", value: "IGNORED" },
] as const;

type StatusFilter = (typeof statusFilters)[number]["value"];

const outcomeFilters = [
  { label: "Все итоги", value: "ALL" },
  { label: "Работает", value: "WORKED" },
  { label: "Проблемы", value: "ISSUE" },
  { label: "Блокеры", value: "BLOCKED" },
] as const;

type OutcomeFilter = (typeof outcomeFilters)[number]["value"];

const outcomeLabels: Record<FeedbackOutcome, string> = {
  BLOCKED: "Блокер",
  ISSUE: "Проблема",
  WORKED: "Работает",
};

const reasonLabels: Record<FeedbackReason, string> = {
  AUDIO_VIDEO: "Аудио/видео",
  CHAT: "Чат",
  CONNECTION: "Связь",
  FILE: "Файл",
  OTHER: "Другое",
  PERFORMANCE: "Производительность",
  ROOM_ACCESS: "Доступ",
  SUCCESS: "Успех",
  SYNC: "Синхронизация",
  VOICE: "Голос",
};

const statusLabels: Record<FeedbackTriageStatus, string> = {
  IGNORED: "Игнор",
  NEW: "Новый",
  RESOLVED: "Решён",
  REVIEWING: "В работе",
};

const severityLabels: Record<FeedbackSeverity, string> = {
  BLOCKER: "Blocker",
  HIGH: "High",
  LOW: "Low",
  MEDIUM: "Medium",
  UNSET: "Unset",
};

const roleLabels = {
  GUEST: "Guest",
  HOST: "Host",
} as const;

const dateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  month: "2-digit",
});

type LoadStatus = "idle" | "loading" | "ready" | "error";

function readStoredOperatorToken() {
  try {
    return globalThis.localStorage?.getItem(operatorTokenStorageKey) ?? "";
  } catch {
    return "";
  }
}

function writeStoredOperatorToken(token: string) {
  try {
    if (token) {
      globalThis.localStorage?.setItem(operatorTokenStorageKey, token);
    } else {
      globalThis.localStorage?.removeItem(operatorTokenStorageKey);
    }
  } catch {
    // The dashboard still works when storage is unavailable.
  }
}

function describeOperatorError(error: unknown) {
  if (error instanceof ApiProblemError) {
    if (error.problem.status === 403) {
      return "Доступ запрещён: проверьте FEEDBACK_ADMIN_TOKEN и X-Feedback-Admin-Token.";
    }
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Не удалось выполнить операцию.";
}

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return dateTimeFormatter.format(parsed);
}

function reportToSummary(report: FeedbackReport): FeedbackReportSummary {
  return {
    assignee: report.assignee,
    correlationId: report.correlationId,
    feedbackId: report.feedbackId,
    messagePreview: report.message?.slice(0, 160),
    outcome: report.outcome,
    participantRole: report.participantRole,
    reason: report.reason,
    receivedAt: report.receivedAt,
    relatedCorrelationId: report.relatedCorrelationId,
    roomId: report.roomId,
    severity: report.severity,
    triageStatus: report.triageStatus,
  };
}

function badgeTone(
  value: FeedbackOutcome | FeedbackSeverity | FeedbackTriageStatus,
): "accent" | "danger" | "neutral" | "success" | "warning" {
  switch (value) {
    case "WORKED":
    case "RESOLVED":
    case "LOW":
      return "success";
    case "ISSUE":
    case "REVIEWING":
    case "MEDIUM":
      return "warning";
    case "BLOCKED":
    case "BLOCKER":
    case "HIGH":
      return "danger";
    case "NEW":
      return "accent";
    default:
      return "neutral";
  }
}

function countOpen(reports: FeedbackReportSummary[]) {
  return reports.filter(
    (report) => report.triageStatus === "NEW" || report.triageStatus === "REVIEWING",
  ).length;
}

function countBlockers(reports: FeedbackReportSummary[]) {
  return reports.filter((report) => report.outcome === "BLOCKED" || report.severity === "BLOCKER")
    .length;
}

export function OperatorDashboardPage() {
  const [token, setToken] = useState(readStoredOperatorToken);
  const [tokenDraft, setTokenDraft] = useState(token);
  const [reports, setReports] = useState<FeedbackReportSummary[]>([]);
  const [listedAt, setListedAt] = useState<string | null>(null);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("OPEN");
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("ALL");
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<FeedbackReport | null>(null);
  const [detailStatus, setDetailStatus] = useState<LoadStatus>("idle");
  const [actionReportId, setActionReportId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const listAbortControllerRef = useRef<AbortController | null>(null);
  const detailAbortControllerRef = useRef<AbortController | null>(null);
  const exportAbortControllerRef = useRef<AbortController | null>(null);
  const triageAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      listAbortControllerRef.current?.abort();
      detailAbortControllerRef.current?.abort();
      exportAbortControllerRef.current?.abort();
      triageAbortControllerRef.current?.abort();
    },
    [],
  );

  const metrics = useMemo(() => {
    const rooms = new Set(reports.map((report) => report.roomId).filter(Boolean));
    const issues = reports.filter(
      (report) => report.outcome === "ISSUE" || report.outcome === "BLOCKED",
    );

    return {
      blockers: countBlockers(reports),
      issues: issues.length,
      open: countOpen(reports),
      rooms: rooms.size,
      total: reports.length,
      worked: reports.filter((report) => report.outcome === "WORKED").length,
    };
  }, [reports]);

  const filteredReports = useMemo(() => {
    return reports.filter((report) => {
      const matchesStatus =
        statusFilter === "ALL"
          ? true
          : statusFilter === "OPEN"
            ? report.triageStatus === "NEW" || report.triageStatus === "REVIEWING"
            : report.triageStatus === statusFilter;
      const matchesOutcome = outcomeFilter === "ALL" ? true : report.outcome === outcomeFilter;

      return matchesStatus && matchesOutcome;
    });
  }, [outcomeFilter, reports, statusFilter]);

  async function loadReports(nextToken: string) {
    const normalizedToken = nextToken.trim();
    if (!normalizedToken) {
      return;
    }

    listAbortControllerRef.current?.abort();
    const controller = new AbortController();
    listAbortControllerRef.current = controller;
    setLoadStatus("loading");
    setError(null);

    try {
      const response = await listFeedbackReports(normalizedToken, 100, controller.signal);
      if (controller.signal.aborted || listAbortControllerRef.current !== controller) {
        return;
      }
      setReports(response.reports);
      setListedAt(response.listedAt);
      setLoadStatus("ready");
    } catch (loadError) {
      if (controller.signal.aborted || listAbortControllerRef.current !== controller) {
        return;
      }
      setError(describeOperatorError(loadError));
      setLoadStatus("error");
    } finally {
      if (listAbortControllerRef.current === controller) {
        listAbortControllerRef.current = null;
      }
    }
  }

  function handleTokenSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextToken = tokenDraft.trim();
    listAbortControllerRef.current?.abort();
    listAbortControllerRef.current = null;
    detailAbortControllerRef.current?.abort();
    detailAbortControllerRef.current = null;
    exportAbortControllerRef.current?.abort();
    exportAbortControllerRef.current = null;
    triageAbortControllerRef.current?.abort();
    triageAbortControllerRef.current = null;
    setToken(nextToken);
    writeStoredOperatorToken(nextToken);
    setError(null);
    setNotice(null);
    setReports([]);
    setListedAt(null);
    setLoadStatus("idle");
    setSelectedReport(null);
    setSelectedReportId(null);
    setDetailStatus("idle");
    setActionReportId(null);
    setExporting(false);
    if (!nextToken) {
      return;
    }
    void loadReports(nextToken);
  }

  function handleTokenReset() {
    listAbortControllerRef.current?.abort();
    listAbortControllerRef.current = null;
    detailAbortControllerRef.current?.abort();
    detailAbortControllerRef.current = null;
    exportAbortControllerRef.current?.abort();
    exportAbortControllerRef.current = null;
    triageAbortControllerRef.current?.abort();
    triageAbortControllerRef.current = null;
    setToken("");
    setTokenDraft("");
    writeStoredOperatorToken("");
    setError(null);
    setNotice(null);
    setReports([]);
    setListedAt(null);
    setLoadStatus("idle");
    setSelectedReport(null);
    setSelectedReportId(null);
    setDetailStatus("idle");
    setActionReportId(null);
    setExporting(false);
  }

  async function handleOpenReport(report: FeedbackReportSummary) {
    if (!token.trim()) {
      return;
    }

    detailAbortControllerRef.current?.abort();
    const controller = new AbortController();
    detailAbortControllerRef.current = controller;
    const normalizedToken = token.trim();
    setSelectedReportId(report.feedbackId);
    setSelectedReport(null);
    setDetailStatus("loading");
    setError(null);

    try {
      const detail = await getFeedbackReport(normalizedToken, report.feedbackId, controller.signal);
      if (controller.signal.aborted || detailAbortControllerRef.current !== controller) {
        return;
      }
      setSelectedReport(detail);
      setDetailStatus("ready");
    } catch (openError) {
      if (controller.signal.aborted || detailAbortControllerRef.current !== controller) {
        return;
      }
      setDetailStatus("error");
      setError(describeOperatorError(openError));
    } finally {
      if (detailAbortControllerRef.current === controller) {
        detailAbortControllerRef.current = null;
      }
    }
  }

  async function handleTriage(
    report: FeedbackReportSummary,
    request: Parameters<typeof updateFeedbackReportTriage>[2],
  ) {
    if (!token.trim()) {
      return;
    }

    triageAbortControllerRef.current?.abort();
    const controller = new AbortController();
    triageAbortControllerRef.current = controller;
    setActionReportId(report.feedbackId);
    setError(null);
    setNotice(null);

    try {
      const updatedReport = await updateFeedbackReportTriage(
        token.trim(),
        report.feedbackId,
        request,
        controller.signal,
      );
      if (controller.signal.aborted || triageAbortControllerRef.current !== controller) {
        return;
      }
      const updatedSummary = reportToSummary(updatedReport);
      setReports((currentReports) =>
        currentReports.map((currentReport) =>
          currentReport.feedbackId === updatedSummary.feedbackId ? updatedSummary : currentReport,
        ),
      );
      if (selectedReportId === updatedReport.feedbackId) {
        setSelectedReport(updatedReport);
        setDetailStatus("ready");
      }
      setNotice(`Triage обновлён: ${statusLabels[updatedReport.triageStatus]}`);
    } catch (triageError) {
      if (controller.signal.aborted || triageAbortControllerRef.current !== controller) {
        return;
      }
      setError(describeOperatorError(triageError));
    } finally {
      if (triageAbortControllerRef.current === controller) {
        triageAbortControllerRef.current = null;
        setActionReportId(null);
      }
    }
  }

  async function handleExport() {
    if (!token.trim()) {
      return;
    }

    exportAbortControllerRef.current?.abort();
    const controller = new AbortController();
    exportAbortControllerRef.current = controller;
    setExporting(true);
    setError(null);
    setNotice(null);

    try {
      const exported = await exportFeedbackReports(token.trim(), 200, controller.signal);
      if (controller.signal.aborted || exportAbortControllerRef.current !== controller) {
        return;
      }
      const blob = new Blob([JSON.stringify(exported, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `watch-together-feedback-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice(`Экспортировано reports: ${exported.count}`);
    } catch (exportError) {
      if (controller.signal.aborted || exportAbortControllerRef.current !== controller) {
        return;
      }
      setError(describeOperatorError(exportError));
    } finally {
      if (exportAbortControllerRef.current === controller) {
        exportAbortControllerRef.current = null;
        setExporting(false);
      }
    }
  }

  const isBusy = loadStatus === "loading";
  const hasToken = Boolean(token.trim());

  return (
    <section className="operator-page" aria-labelledby="operator-title">
      <div className="operator-page__heading">
        <div>
          <p className="eyebrow">Beta ops</p>
          <h1 id="operator-title">Операторская панель</h1>
        </div>
        <span
          className={`operator-page__state operator-page__state--${
            loadStatus === "error" ? "error" : hasToken ? "ready" : "idle"
          }`}
        >
          <ShieldCheck size={16} aria-hidden="true" />
          {hasToken ? "Feedback ops" : "Token required"}
        </span>
      </div>

      <form className="operator-token" onSubmit={handleTokenSubmit}>
        <label className="operator-token__field" htmlFor="operator-token">
          <span>Admin token</span>
          <input
            id="operator-token"
            autoComplete="off"
            type="password"
            value={tokenDraft}
            onChange={(event) => setTokenDraft(event.target.value)}
            placeholder="FEEDBACK_ADMIN_TOKEN"
          />
        </label>
        <button className="button button--primary" type="submit">
          <ShieldCheck size={18} aria-hidden="true" />
          Подключить
        </button>
        <button className="button" type="button" onClick={handleTokenReset}>
          Сбросить
        </button>
      </form>

      {error ? (
        <p className="operator-alert operator-alert--error" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          {error}
        </p>
      ) : null}

      {notice ? (
        <p className="operator-alert operator-alert--success" role="status">
          <CheckCircle2 size={17} aria-hidden="true" />
          {notice}
        </p>
      ) : null}

      <div className="operator-toolbar">
        <div className="operator-toolbar__filters" aria-label="Фильтр по статусу">
          {statusFilters.map((filter) => (
            <button
              key={filter.value}
              className={`operator-filter ${statusFilter === filter.value ? "operator-filter--active" : ""}`}
              type="button"
              onClick={() => setStatusFilter(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className="operator-toolbar__filters" aria-label="Фильтр по итогу">
          {outcomeFilters.map((filter) => (
            <button
              key={filter.value}
              className={`operator-filter ${outcomeFilter === filter.value ? "operator-filter--active" : ""}`}
              type="button"
              onClick={() => setOutcomeFilter(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className="operator-toolbar__actions">
          <button
            className="button"
            type="button"
            disabled={!hasToken || isBusy}
            onClick={() => void loadReports(token)}
          >
            <RefreshCw size={18} aria-hidden="true" />
            Обновить
          </button>
          <button
            className="button button--primary"
            type="button"
            disabled={!hasToken || exporting}
            onClick={handleExport}
          >
            <Download size={18} aria-hidden="true" />
            Экспорт
          </button>
        </div>
      </div>

      <div className="operator-metrics" aria-label="Сводка feedback reports">
        <MetricTile label="Всего" value={metrics.total} />
        <MetricTile
          label="Открыто"
          value={metrics.open}
          tone={metrics.open > 0 ? "warning" : "success"}
        />
        <MetricTile
          label="Блокеры"
          value={metrics.blockers}
          tone={metrics.blockers > 0 ? "danger" : "success"}
        />
        <MetricTile
          label="Проблемы"
          value={metrics.issues}
          tone={metrics.issues > 0 ? "warning" : "success"}
        />
        <MetricTile label="Работает" value={metrics.worked} />
        <MetricTile label="Комнаты" value={metrics.rooms} />
      </div>

      <section className="operator-panel" aria-labelledby="operator-reports-title">
        <div className="operator-panel__heading">
          <div>
            <h2 id="operator-reports-title">Feedback reports</h2>
            <p>{listedAt ? `Обновлено ${formatDateTime(listedAt)}` : "Нет загруженной выборки"}</p>
          </div>
          <span>{isBusy ? "Загрузка" : `${filteredReports.length}/${reports.length}`}</span>
        </div>

        {loadStatus === "ready" && filteredReports.length === 0 ? (
          <p className="operator-empty">Нет reports под текущими фильтрами.</p>
        ) : null}

        {loadStatus === "idle" ? (
          <p className="operator-empty">Укажите operator token для чтения reports.</p>
        ) : null}

        {filteredReports.length > 0 ? (
          <div className="operator-table">
            <table>
              <thead>
                <tr>
                  <th>Время</th>
                  <th>Итог</th>
                  <th>Причина</th>
                  <th>Room</th>
                  <th>Triage</th>
                  <th>Комментарий</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {filteredReports.map((report) => (
                  <tr
                    key={report.feedbackId}
                    className={
                      selectedReportId === report.feedbackId ? "operator-row--selected" : undefined
                    }
                  >
                    <td>
                      <time dateTime={report.receivedAt}>{formatDateTime(report.receivedAt)}</time>
                      <span className="operator-table__sub">{report.feedbackId.slice(0, 8)}</span>
                    </td>
                    <td>
                      <Badge tone={badgeTone(report.outcome)}>
                        {outcomeLabels[report.outcome]}
                      </Badge>
                      <span className="operator-table__sub">
                        {report.participantRole
                          ? roleLabels[report.participantRole]
                          : "роль не указана"}
                      </span>
                    </td>
                    <td>{reasonLabels[report.reason]}</td>
                    <td>
                      {report.roomId ? <code>{report.roomId.slice(0, 8)}</code> : "без room"}
                      <span className="operator-table__sub">
                        {report.correlationId.slice(0, 12)}
                      </span>
                    </td>
                    <td>
                      <Badge tone={badgeTone(report.triageStatus)}>
                        {statusLabels[report.triageStatus]}
                      </Badge>
                      <span className="operator-table__sub">{severityLabels[report.severity]}</span>
                    </td>
                    <td>{report.messagePreview || "без комментария"}</td>
                    <td>
                      <div className="operator-table__actions">
                        <button
                          className="icon-button"
                          type="button"
                          onClick={() => void handleOpenReport(report)}
                        >
                          <span className="visually-hidden">
                            Открыть отзыв {report.feedbackId.slice(0, 8)}
                          </span>
                          <Eye size={17} aria-hidden="true" />
                        </button>
                        <button
                          className="button button--compact"
                          type="button"
                          disabled={actionReportId !== null}
                          onClick={() =>
                            void handleTriage(report, {
                              assignee: "beta-ops",
                              severity: report.severity === "UNSET" ? "MEDIUM" : report.severity,
                              status: "REVIEWING",
                            })
                          }
                        >
                          В работу
                        </button>
                        <button
                          className="button button--compact"
                          type="button"
                          disabled={actionReportId !== null}
                          onClick={() =>
                            void handleTriage(report, {
                              assignee: "beta-ops",
                              note: "Marked from operator dashboard",
                              severity: "BLOCKER",
                              status: "REVIEWING",
                            })
                          }
                        >
                          Blocker
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="operator-detail" aria-labelledby="operator-detail-title">
        <div className="operator-panel__heading">
          <div>
            <h2 id="operator-detail-title">Детали отчёта</h2>
            <p>{selectedReportId ? selectedReportId : "Отчёт не выбран"}</p>
          </div>
          {selectedReport ? (
            <Badge tone={badgeTone(selectedReport.severity)}>
              {severityLabels[selectedReport.severity]}
            </Badge>
          ) : null}
        </div>

        {detailStatus === "loading" ? <p className="operator-empty">Загружаем детали.</p> : null}
        {detailStatus === "error" ? <p className="operator-empty">Детали не загрузились.</p> : null}
        {!selectedReportId ? <p className="operator-empty">Выберите report из таблицы.</p> : null}

        {selectedReport ? (
          <>
            <dl className="operator-detail__grid">
              <div>
                <dt>Outcome</dt>
                <dd>{outcomeLabels[selectedReport.outcome]}</dd>
              </div>
              <div>
                <dt>Reason</dt>
                <dd>{reasonLabels[selectedReport.reason]}</dd>
              </div>
              <div>
                <dt>Room</dt>
                <dd>{selectedReport.roomId ?? "без room"}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>
                  {selectedReport.participantRole
                    ? roleLabels[selectedReport.participantRole]
                    : "не указана"}
                </dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{statusLabels[selectedReport.triageStatus]}</dd>
              </div>
              <div>
                <dt>Assignee</dt>
                <dd>{selectedReport.assignee ?? "не назначен"}</dd>
              </div>
            </dl>

            <div className="operator-detail__message">
              <h3>Комментарий</h3>
              <p>{selectedReport.message || "Комментария нет."}</p>
            </div>

            <div className="operator-detail__actions">
              <button
                className="button button--primary"
                type="button"
                disabled={actionReportId !== null}
                onClick={() =>
                  void handleTriage(selectedReport, {
                    severity:
                      selectedReport.severity === "UNSET" ? "MEDIUM" : selectedReport.severity,
                    status: "REVIEWING",
                  })
                }
              >
                В работу
              </button>
              <button
                className="button"
                type="button"
                disabled={actionReportId !== null}
                onClick={() =>
                  void handleTriage(selectedReport, {
                    severity: selectedReport.severity === "UNSET" ? "LOW" : selectedReport.severity,
                    status: "RESOLVED",
                  })
                }
              >
                Решено
              </button>
              <button
                className="button"
                type="button"
                disabled={actionReportId !== null}
                onClick={() =>
                  void handleTriage(selectedReport, {
                    severity: selectedReport.severity === "UNSET" ? "LOW" : selectedReport.severity,
                    status: "IGNORED",
                  })
                }
              >
                Игнор
              </button>
            </div>

            {selectedReport.metadata ? (
              <pre className="operator-metadata">
                {JSON.stringify(selectedReport.metadata, null, 2)}
              </pre>
            ) : null}
          </>
        ) : null}
      </section>
    </section>
  );
}

function MetricTile({
  label,
  tone = "neutral",
  value,
}: {
  label: string;
  tone?: "danger" | "neutral" | "success" | "warning";
  value: number;
}) {
  return (
    <div className={`operator-metric operator-metric--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Badge({
  children,
  tone,
}: {
  children: string;
  tone: "accent" | "danger" | "neutral" | "success" | "warning";
}) {
  return <span className={`operator-badge operator-badge--${tone}`}>{children}</span>;
}
