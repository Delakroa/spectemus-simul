import type { Room as LiveKitRoom } from "livekit-client";

export type QualityIndicatorStatus = "idle" | "checking" | "good" | "warning" | "poor" | "lost";

export type QualityMetrics = {
  bitrateKbps: number | null;
  frameHeight: number | null;
  frameWidth: number | null;
  framesPerSecond: number | null;
  jitterMs: number | null;
  packetLossPercent: number | null;
  rttMs: number | null;
};

export type QualityIndicatorsState = {
  connectionQuality: string | null;
  download: QualityMetrics;
  status: QualityIndicatorStatus;
  updatedAt: string | null;
  upload: QualityMetrics;
  warning: string | null;
};

export type QualityIndicatorController = {
  disconnect: () => void;
};

export type QualityIndicatorHandlers = {
  onStateChange: (state: QualityIndicatorsState) => void;
};

type TrackStats = {
  bytesReceived?: number;
  bytesSent?: number;
  frameHeight?: number;
  frameWidth?: number;
  framesPerSecond?: number;
  jitter?: number;
  packetsLost?: number;
  packetsReceived?: number;
  packetsSent?: number;
  qualityLimitationReason?: string;
  roundTripTime?: number;
  streamId?: string;
  timestamp: number;
};

type TrackWithStats = {
  getReceiverStats?: () => Promise<TrackStats | TrackStats[] | undefined>;
  getSenderStats?: () => Promise<TrackStats | TrackStats[] | undefined>;
};

type TrackPublicationWithStats = {
  track?: TrackWithStats | null;
};

type ParticipantWithTracks = {
  connectionQuality?: string;
  identity?: string;
  trackPublications?: Map<string, TrackPublicationWithStats> | Iterable<TrackPublicationWithStats>;
};

type PreviousBytes = {
  bytes: number;
  timestamp: number;
};

const QUALITY_POLL_INTERVAL_MS = 2_000;

const emptyMetrics: QualityMetrics = {
  bitrateKbps: null,
  frameHeight: null,
  frameWidth: null,
  framesPerSecond: null,
  jitterMs: null,
  packetLossPercent: null,
  rttMs: null,
};

export const idleQualityIndicatorsState: QualityIndicatorsState = {
  connectionQuality: null,
  download: emptyMetrics,
  status: "idle",
  updatedAt: null,
  upload: emptyMetrics,
  warning: null,
};

export function createQualityIndicatorController(
  room: LiveKitRoom,
  handlers: QualityIndicatorHandlers,
): QualityIndicatorController {
  let disconnected = false;
  const qualityByParticipant = new Map<string, string>();
  const previousUploadBytes = new Map<string, PreviousBytes>();
  const previousDownloadBytes = new Map<string, PreviousBytes>();

  seedConnectionQuality(room, qualityByParticipant);

  const emit = async () => {
    if (disconnected) {
      return;
    }

    try {
      const [uploadStats, downloadStats] = await Promise.all([
        collectSenderStats(room),
        collectReceiverStats(room),
      ]);

      if (disconnected) {
        return;
      }

      const upload = aggregateStats(uploadStats, "upload", previousUploadBytes);
      const download = aggregateStats(downloadStats, "download", previousDownloadBytes);
      const connectionQuality = worstConnectionQuality(qualityByParticipant);
      const assessment = assessQuality(connectionQuality, upload, download);

      handlers.onStateChange({
        connectionQuality,
        download,
        status: assessment.status,
        updatedAt: new Date().toISOString(),
        upload,
        warning: assessment.warning,
      });
    } catch (error) {
      if (disconnected) {
        return;
      }

      handlers.onStateChange({
        ...idleQualityIndicatorsState,
        status: "warning",
        updatedAt: new Date().toISOString(),
        warning:
          error instanceof Error
            ? `Не удалось обновить показатели качества: ${error.message}`
            : "Не удалось обновить показатели качества.",
      });
    }
  };

  const handleConnectionQualityChanged = (quality: unknown, participant: unknown) => {
    const participantWithTracks = participant as ParticipantWithTracks | undefined;
    const identity = participantWithTracks?.identity ?? "local";
    qualityByParticipant.set(identity, normalizeConnectionQuality(String(quality)));
    void emit();
  };

  room.on("connectionQualityChanged", handleConnectionQualityChanged);
  void emit();
  const intervalId = window.setInterval(() => void emit(), QUALITY_POLL_INTERVAL_MS);

  return {
    disconnect: () => {
      disconnected = true;
      window.clearInterval(intervalId);
      room.off("connectionQualityChanged", handleConnectionQualityChanged);
      handlers.onStateChange(idleQualityIndicatorsState);
    },
  };
}

async function collectSenderStats(room: LiveKitRoom) {
  const localParticipant = room.localParticipant as ParticipantWithTracks | undefined;
  const stats: TrackStats[] = [];

  for (const publication of valuesOf<TrackPublicationWithStats>(
    localParticipant?.trackPublications,
  )) {
    const senderStats = await publication.track?.getSenderStats?.();
    stats.push(...normalizeStats(senderStats));
  }

  return stats;
}

async function collectReceiverStats(room: LiveKitRoom) {
  const stats: TrackStats[] = [];

  for (const participant of room.remoteParticipants.values() as Iterable<ParticipantWithTracks>) {
    for (const publication of valuesOf<TrackPublicationWithStats>(participant.trackPublications)) {
      const receiverStats = await publication.track?.getReceiverStats?.();
      stats.push(...normalizeStats(receiverStats));
    }
  }

  return stats;
}

function aggregateStats(
  stats: TrackStats[],
  direction: "download" | "upload",
  previousBytes: Map<string, PreviousBytes>,
): QualityMetrics {
  let bitrateKbps = 0;
  let hasBitrate = false;
  let frameHeight: number | null = null;
  let frameWidth: number | null = null;
  let framesPerSecond: number | null = null;
  let jitterMs: number | null = null;
  let packetLossPercent: number | null = null;
  let rttMs: number | null = null;

  for (const [index, item] of stats.entries()) {
    const bytes = direction === "upload" ? item.bytesSent : item.bytesReceived;
    const key = `${direction}:${item.streamId ?? index}`;
    if (typeof bytes === "number") {
      const previous = previousBytes.get(key);
      if (previous && item.timestamp > previous.timestamp && bytes >= previous.bytes) {
        bitrateKbps += ((bytes - previous.bytes) * 8) / (item.timestamp - previous.timestamp);
        hasBitrate = true;
      }
      previousBytes.set(key, { bytes, timestamp: item.timestamp });
    }

    frameWidth = maxNullable(frameWidth, item.frameWidth);
    frameHeight = maxNullable(frameHeight, item.frameHeight);
    framesPerSecond = maxNullable(framesPerSecond, item.framesPerSecond);

    if (typeof item.jitter === "number") {
      jitterMs = maxNullable(jitterMs, item.jitter * 1000);
    }

    if (typeof item.roundTripTime === "number") {
      rttMs = maxNullable(rttMs, item.roundTripTime * 1000);
    }

    const packets = direction === "upload" ? item.packetsSent : item.packetsReceived;
    if (typeof item.packetsLost === "number" && typeof packets === "number") {
      const totalPackets = item.packetsLost + packets;
      if (totalPackets > 0) {
        packetLossPercent = maxNullable(packetLossPercent, (item.packetsLost / totalPackets) * 100);
      }
    }
  }

  return {
    bitrateKbps: hasBitrate ? Math.round(bitrateKbps) : null,
    frameHeight,
    frameWidth,
    framesPerSecond,
    jitterMs: roundNullable(jitterMs),
    packetLossPercent: roundNullable(packetLossPercent),
    rttMs: roundNullable(rttMs),
  };
}

function assessQuality(
  connectionQuality: string | null,
  upload: QualityMetrics,
  download: QualityMetrics,
): { status: QualityIndicatorStatus; warning: string | null } {
  if (connectionQuality === "lost") {
    return { status: "lost", warning: "LiveKit потерял соединение с участником." };
  }

  if (connectionQuality === "poor") {
    return { status: "poor", warning: "LiveKit сообщает о плохом качестве соединения." };
  }

  const packetLoss = Math.max(upload.packetLossPercent ?? 0, download.packetLossPercent ?? 0);
  const jitter = Math.max(upload.jitterMs ?? 0, download.jitterMs ?? 0);
  const rtt = upload.rttMs ?? 0;

  if (packetLoss >= 5) {
    return { status: "poor", warning: "Высокие потери пакетов, возможны рывки видео или звука." };
  }

  if (jitter >= 90 || rtt >= 450) {
    return { status: "poor", warning: "Сеть нестабильна: высокий jitter или RTT." };
  }

  if (packetLoss >= 1) {
    return { status: "warning", warning: "Есть потери пакетов, качество может проседать." };
  }

  if (jitter >= 40 || rtt >= 200) {
    return { status: "warning", warning: "Задержка или jitter выше обычного." };
  }

  if (!hasAnyMetric(upload) && !hasAnyMetric(download) && !connectionQuality) {
    return { status: "checking", warning: null };
  }

  return { status: "good", warning: null };
}

function seedConnectionQuality(room: LiveKitRoom, qualityByParticipant: Map<string, string>) {
  const localParticipant = room.localParticipant as ParticipantWithTracks | undefined;
  if (localParticipant?.connectionQuality) {
    qualityByParticipant.set(
      localParticipant.identity ?? "local",
      normalizeConnectionQuality(localParticipant.connectionQuality),
    );
  }

  let remoteIndex = 0;
  for (const participant of room.remoteParticipants.values() as Iterable<ParticipantWithTracks>) {
    if (participant.connectionQuality) {
      qualityByParticipant.set(
        participant.identity ?? `remote-${remoteIndex}`,
        normalizeConnectionQuality(participant.connectionQuality),
      );
    }
    remoteIndex += 1;
  }
}

function worstConnectionQuality(qualityByParticipant: Map<string, string>) {
  const weights: Record<string, number> = {
    excellent: 1,
    good: 2,
    lost: 5,
    poor: 4,
    unknown: 0,
  };

  let worst: string | null = null;
  let worstWeight = -1;
  for (const quality of qualityByParticipant.values()) {
    const normalized = normalizeConnectionQuality(quality);
    const weight = weights[normalized] ?? 0;
    if (weight > worstWeight) {
      worst = normalized;
      worstWeight = weight;
    }
  }

  return worst;
}

function normalizeConnectionQuality(quality: string) {
  return quality.toLowerCase();
}

function hasAnyMetric(metrics: QualityMetrics) {
  return Object.values(metrics).some((value) => value !== null);
}

function normalizeStats(stats: TrackStats | TrackStats[] | undefined) {
  if (!stats) {
    return [];
  }

  return Array.isArray(stats) ? stats : [stats];
}

function valuesOf<T>(collection: Map<string, T> | Iterable<T> | undefined) {
  return collection ? Array.from(collection instanceof Map ? collection.values() : collection) : [];
}

function maxNullable(current: number | null, next: number | undefined) {
  if (typeof next !== "number" || !Number.isFinite(next)) {
    return current;
  }

  return current === null ? next : Math.max(current, next);
}

function roundNullable(value: number | null) {
  return value === null ? null : Math.round(value * 10) / 10;
}
