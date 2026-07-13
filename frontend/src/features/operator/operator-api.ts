import { z } from "zod";

import { feedbackOutcomeSchema, feedbackReasonSchema } from "../feedback/feedback-api";
import { createResponseError, roomIdSchema } from "../rooms/room-api";

const participantRoleSchema = z.enum(["HOST", "GUEST"]);

export const feedbackTriageStatusSchema = z.enum(["NEW", "REVIEWING", "RESOLVED", "IGNORED"]);
export const feedbackSeveritySchema = z.enum(["UNSET", "LOW", "MEDIUM", "HIGH", "BLOCKER"]);

const feedbackClientMetadataSchema = z
  .object({
    userAgent: z.string().max(512).nullable().optional(),
    language: z.string().max(32).nullable().optional(),
    platform: z.string().max(64).nullable().optional(),
    viewportWidth: z.number().int().min(0).max(10000).nullable().optional(),
    viewportHeight: z.number().int().min(0).max(10000).nullable().optional(),
    devicePixelRatio: z.number().min(0).max(10).nullable().optional(),
    networkEffectiveType: z.string().max(32).nullable().optional(),
    networkDownlinkMbps: z.number().min(0).max(10000).nullable().optional(),
    networkRttMs: z.number().int().min(0).max(60000).nullable().optional(),
    networkSaveData: z.boolean().nullable().optional(),
    roomStatus: z.string().max(32).nullable().optional(),
    roomConnectionStatus: z.string().max(32).nullable().optional(),
    liveKitStatus: z.string().max(32).nullable().optional(),
    qualityStatus: z.string().max(32).nullable().optional(),
    participantCount: z.number().int().min(0).max(4).nullable().optional(),
  })
  .strict();

const feedbackReportSummarySchema = z
  .object({
    feedbackId: z.uuid(),
    correlationId: z.string(),
    receivedAt: z.iso.datetime(),
    outcome: feedbackOutcomeSchema,
    reason: feedbackReasonSchema,
    roomId: roomIdSchema.nullable().optional(),
    participantRole: participantRoleSchema.nullable().optional(),
    relatedCorrelationId: z.uuid().nullable().optional(),
    triageStatus: feedbackTriageStatusSchema,
    severity: feedbackSeveritySchema,
    assignee: z.string().max(120).nullable().optional(),
    messagePreview: z.string().max(160).nullable().optional(),
  })
  .strict();

const feedbackReportSchema = feedbackReportSummarySchema
  .extend({
    message: z.string().max(2000).nullable().optional(),
    metadata: feedbackClientMetadataSchema.nullable().optional(),
    triageNote: z.string().max(1000).nullable().optional(),
    triagedAt: z.iso.datetime().nullable().optional(),
  })
  .strict();

const feedbackReportListResponseSchema = z
  .object({
    listedAt: z.iso.datetime(),
    count: z.number().int().min(0),
    reports: z.array(feedbackReportSummarySchema),
  })
  .strict();

const feedbackReportExportResponseSchema = z
  .object({
    exportedAt: z.iso.datetime(),
    count: z.number().int().min(0),
    reports: z.array(feedbackReportSchema),
  })
  .strict();

const feedbackTriageRequestSchema = z
  .object({
    status: feedbackTriageStatusSchema,
    severity: feedbackSeveritySchema.optional(),
    assignee: z.string().max(120).optional(),
    note: z.string().max(1000).optional(),
  })
  .strict();

export type FeedbackTriageStatus = z.infer<typeof feedbackTriageStatusSchema>;
export type FeedbackSeverity = z.infer<typeof feedbackSeveritySchema>;
export type FeedbackReportSummary = z.infer<typeof feedbackReportSummarySchema>;
export type FeedbackReport = z.infer<typeof feedbackReportSchema>;
export type FeedbackReportListResponse = z.infer<typeof feedbackReportListResponseSchema>;
export type FeedbackReportExportResponse = z.infer<typeof feedbackReportExportResponseSchema>;
export type FeedbackTriageRequest = z.infer<typeof feedbackTriageRequestSchema>;

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

async function operatorRequest<T>(
  path: string,
  token: string,
  schema: z.ZodType<T>,
  options: {
    body?: unknown;
    method?: "GET" | "PATCH";
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Accept: "application/json",
      "X-Feedback-Admin-Token": token,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: "include",
    signal: options.signal,
  });

  if (!response.ok) {
    throw await createResponseError(response);
  }

  return schema.parse(await response.json());
}

export function listFeedbackReports(
  token: string,
  limit = 100,
  signal?: AbortSignal,
): Promise<FeedbackReportListResponse> {
  return operatorRequest(
    `/api/v1/feedback/reports?limit=${encodeURIComponent(String(limit))}`,
    token,
    feedbackReportListResponseSchema,
    { signal },
  );
}

export function exportFeedbackReports(
  token: string,
  limit = 200,
  signal?: AbortSignal,
): Promise<FeedbackReportExportResponse> {
  return operatorRequest(
    `/api/v1/feedback/reports/export?limit=${encodeURIComponent(String(limit))}`,
    token,
    feedbackReportExportResponseSchema,
    { signal },
  );
}

export function getFeedbackReport(
  token: string,
  feedbackId: string,
  signal?: AbortSignal,
): Promise<FeedbackReport> {
  return operatorRequest(
    `/api/v1/feedback/reports/${encodeURIComponent(feedbackId)}`,
    token,
    feedbackReportSchema,
    { signal },
  );
}

export function updateFeedbackReportTriage(
  token: string,
  feedbackId: string,
  request: FeedbackTriageRequest,
  signal?: AbortSignal,
): Promise<FeedbackReport> {
  return operatorRequest(`/api/v1/feedback/reports/${feedbackId}`, token, feedbackReportSchema, {
    body: feedbackTriageRequestSchema.parse(request),
    method: "PATCH",
    signal,
  });
}
