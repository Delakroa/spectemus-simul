import { z } from "zod";

const healthResponseSchema = z.object({
  status: z.literal("UP"),
  checkedAt: z.iso.datetime(),
});

const versionResponseSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  buildTime: z.string().min(1),
  apiVersion: z.string().min(1),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type VersionResponse = z.infer<typeof versionResponseSchema>;

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

async function request<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      Accept: "application/json",
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Backend вернул HTTP ${response.status}`);
  }

  return schema.parse(await response.json());
}

export function getSystemHealth(signal?: AbortSignal) {
  return request("/api/v1/health", healthResponseSchema, signal);
}

export function getSystemVersion(signal?: AbortSignal) {
  return request("/api/v1/version", versionResponseSchema, signal);
}
