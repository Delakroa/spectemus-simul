import { z } from "zod";

import { createResponseError, roomIdSchema } from "../rooms/room-api";

export const feedbackOutcomeSchema = z.enum(["WORKED", "ISSUE", "BLOCKED"]);
export const feedbackReasonSchema = z.enum([
  "SUCCESS",
  "CONNECTION",
  "AUDIO_VIDEO",
  "FILE",
  "VOICE",
  "SYNC",
  "CHAT",
  "ROOM_ACCESS",
  "PERFORMANCE",
  "OTHER",
]);

const participantRoleSchema = z.enum(["HOST", "GUEST"]);

const feedbackClientMetadataSchema = z
  .object({
    userAgent: z.string().max(512).optional(),
    language: z.string().max(32).optional(),
    platform: z.string().max(64).optional(),
    viewportWidth: z.number().int().min(0).max(10000).optional(),
    viewportHeight: z.number().int().min(0).max(10000).optional(),
    devicePixelRatio: z.number().min(0).max(10).optional(),
    networkEffectiveType: z.string().max(32).optional(),
    networkDownlinkMbps: z.number().min(0).max(10000).optional(),
    networkRttMs: z.number().int().min(0).max(60000).optional(),
    networkSaveData: z.boolean().optional(),
    roomStatus: z.string().max(32).optional(),
    roomConnectionStatus: z.string().max(32).optional(),
    liveKitStatus: z.string().max(32).optional(),
    qualityStatus: z.string().max(32).optional(),
    participantCount: z.number().int().min(0).max(4).optional(),
  })
  .strict();

const submitFeedbackRequestSchema = z
  .object({
    outcome: feedbackOutcomeSchema,
    reason: feedbackReasonSchema,
    message: z.string().max(2000).optional(),
    roomId: roomIdSchema.optional(),
    participantRole: participantRoleSchema.optional(),
    relatedCorrelationId: z.uuid().optional(),
    metadata: feedbackClientMetadataSchema.optional(),
  })
  .strict();

const feedbackResponseSchema = z
  .object({
    feedbackId: z.uuid(),
    correlationId: z.uuid(),
    receivedAt: z.iso.datetime(),
  })
  .strict();

export type FeedbackOutcome = z.infer<typeof feedbackOutcomeSchema>;
export type FeedbackReason = z.infer<typeof feedbackReasonSchema>;
export type FeedbackClientMetadata = z.infer<typeof feedbackClientMetadataSchema>;
export type SubmitFeedbackRequest = z.infer<typeof submitFeedbackRequestSchema>;
export type FeedbackResponse = z.infer<typeof feedbackResponseSchema>;

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export async function submitFeedback(
  request: SubmitFeedbackRequest,
  signal?: AbortSignal,
): Promise<FeedbackResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/feedback`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(submitFeedbackRequestSchema.parse(request)),
    credentials: "include",
    signal,
  });

  if (!response.ok) {
    throw await createResponseError(response);
  }

  return feedbackResponseSchema.parse(await response.json());
}
