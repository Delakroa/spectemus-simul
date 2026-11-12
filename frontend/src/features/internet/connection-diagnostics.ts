import type {
  LiveKitConnectionQuality,
  LiveKitConnectionStatus,
} from "../rooms/livekit-connection";

export type ConnectionDiagnostics = {
  status: LiveKitConnectionStatus;
  quality: LiveKitConnectionQuality;
  reconnectCount: number;
};

export const initialConnectionDiagnostics: ConnectionDiagnostics = {
  status: "idle",
  quality: "unknown",
  reconnectCount: 0,
};

export function withConnectionStatus(
  current: ConnectionDiagnostics,
  status: LiveKitConnectionStatus,
): ConnectionDiagnostics {
  if (current.status === status) {
    return current;
  }
  return {
    status,
    quality: "unknown",
    reconnectCount: current.reconnectCount + (status === "reconnecting" ? 1 : 0),
  };
}

export function withConnectionQuality(
  current: ConnectionDiagnostics,
  quality: LiveKitConnectionQuality,
): ConnectionDiagnostics {
  if (current.status !== "connected" || current.quality === quality) {
    return current;
  }
  return { ...current, quality };
}

export function connectionStatusLabel(status: LiveKitConnectionStatus): string {
  switch (status) {
    case "idle":
      return "Ожидает подключения";
    case "connecting":
      return "Подключается";
    case "connected":
      return "Подключено";
    case "reconnecting":
      return "Восстанавливается";
    case "disconnected":
      return "Соединение прервано";
    case "error":
      return "Ошибка подключения";
  }
}

export function connectionQualityLabel(quality: LiveKitConnectionQuality): string {
  switch (quality) {
    case "excellent":
      return "Отличное";
    case "good":
      return "Хорошее";
    case "poor":
      return "Слабое";
    case "lost":
      return "Связь потеряна";
    case "unknown":
      return "Пока неизвестно";
  }
}

export function formatConnectionDiagnostics(diagnostics: ConnectionDiagnostics): string {
  return [
    "Spectemus Simul — Internet-комната",
    `Соединение: ${connectionStatusLabel(diagnostics.status)}`,
    `Качество связи: ${connectionQualityLabel(diagnostics.quality)}`,
    `Попыток автовосстановления: ${diagnostics.reconnectCount}`,
  ].join("\n");
}
