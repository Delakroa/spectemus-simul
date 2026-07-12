import { z } from "zod";

import { createResponseError, roomIdSchema } from "../rooms/room-api";

export const telemetryEventTypeSchema = z.enum([
  "FIRST_FRAME",
  "PLAYBACK_ERROR",
  "PUBLISH_START",
  "PUBLISH_FAILURE",
  "QUALITY_SUMMARY",
]);

export const telemetryQualityStatusSchema = z.enum(["GOOD", "WARNING", "POOR", "LOST", "UNKNOWN"]);

const telemetryRoleSchema = z.enum(["HOST", "GUEST"]);

const telemetryEventSchema = z
  .object({
    type: telemetryEventTypeSchema,
    roomId: roomIdSchema.optional(),
    role: telemetryRoleSchema.optional(),
    qualityStatus: telemetryQualityStatusSchema.optional(),
    detail: z.string().max(200).optional(),
  })
  .strict();

const telemetryRequestSchema = z
  .object({
    events: z.array(telemetryEventSchema).min(1).max(50),
  })
  .strict();

const telemetryResponseSchema = z
  .object({
    telemetryId: z.uuid(),
    correlationId: z.uuid(),
    receivedAt: z.iso.datetime(),
    accepted: z.number().int().min(0),
  })
  .strict();

export type TelemetryEventType = z.infer<typeof telemetryEventTypeSchema>;
export type TelemetryQualityStatus = z.infer<typeof telemetryQualityStatusSchema>;
export type TelemetryRole = z.infer<typeof telemetryRoleSchema>;
export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;
export type TelemetryRequest = z.infer<typeof telemetryRequestSchema>;
export type TelemetryResponse = z.infer<typeof telemetryResponseSchema>;

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export async function submitTelemetry(
  request: TelemetryRequest,
  signal?: AbortSignal,
): Promise<TelemetryResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/telemetry`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(telemetryRequestSchema.parse(request)),
    credentials: "include",
    signal,
  });

  if (!response.ok) {
    throw await createResponseError(response);
  }

  return telemetryResponseSchema.parse(await response.json());
}
