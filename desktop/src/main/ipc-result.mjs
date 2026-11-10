/**
 * Electron `ipcMain.handle` only forwards the message of a rejected Error to
 * the renderer. Returning a resolved envelope keeps structured fields intact
 * through both `invoke` and `contextBridge`.
 */

export function isIpcProblem(value) {
  return (
    !!value &&
    typeof value === "object" &&
    typeof value.status === "number" &&
    (value.name === "ApiProblemError" || typeof value.code === "string")
  );
}

export function toIpcSuccess(data) {
  return { ok: true, data };
}

export function toIpcFailure(problem) {
  const status = typeof problem?.status === "number" ? problem.status : 500;
  return {
    ok: false,
    problem: {
      name: "ApiProblemError",
      code: typeof problem?.code === "string" ? problem.code : undefined,
      status,
      title:
        typeof problem?.title === "string"
          ? problem.title
          : typeof problem?.message === "string"
            ? problem.message
            : "Unexpected error",
      detail: typeof problem?.detail === "string" ? problem.detail : undefined,
      retryable:
        typeof problem?.retryable === "boolean"
          ? problem.retryable
          : status === 429 || status >= 500,
    },
  };
}

export async function runAsIpcResult(work) {
  try {
    return toIpcSuccess(await work());
  } catch (error) {
    if (isIpcProblem(error)) {
      return toIpcFailure(error);
    }
    return toIpcFailure({
      name: "ApiProblemError",
      status: 500,
      title: error instanceof Error ? error.message : "Unexpected error",
      retryable: true,
    });
  }
}
