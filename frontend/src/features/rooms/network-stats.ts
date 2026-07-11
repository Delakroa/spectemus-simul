export type NetworkDirection = "up" | "down";

export type NetworkStats = {
  direction: NetworkDirection;
  rttMs: number | null;
  jitterMs: number | null;
  packetLoss: number;
  bitrateKbps: number | null;
};

export type NetworkStatsSample = {
  timestamp: number;
  bytes: number;
  packets: number;
  packetsLost: number;
};

// Minimal shape of a WebRTC stat entry; only fields we read are declared.
export type RtcStatLike = {
  type?: string;
  bytesSent?: number;
  bytesReceived?: number;
  packetsSent?: number;
  packetsReceived?: number;
  packetsLost?: number;
  jitter?: number;
  roundTripTime?: number;
  currentRoundTripTime?: number;
  nominated?: boolean;
  timestamp?: number;
};

type StatsTrack = {
  getRTCStatsReport?: () => Promise<RTCStatsReport | undefined>;
};

type StatsPublication = { track?: StatsTrack | null };
type StatsParticipant = { trackPublications: Map<string, StatsPublication> };

export type StatsRoom = {
  localParticipant: StatsParticipant;
  remoteParticipants: Map<string, StatsParticipant>;
};

export function collectRtcStats(report: RTCStatsReport): RtcStatLike[] {
  const stats: RtcStatLike[] = [];
  report.forEach((stat) => stats.push(stat as RtcStatLike));
  return stats;
}

/**
 * Folds raw WebRTC stat entries into a privacy-safe network summary. RTT and
 * jitter are reported in milliseconds; packet loss is a 0..1 fraction over the
 * interval since `previous` (falls back to cumulative loss on the first sample).
 */
export function computeNetworkStats(
  reports: readonly RtcStatLike[],
  direction: NetworkDirection,
  previous: NetworkStatsSample | null,
): { stats: NetworkStats; sample: NetworkStatsSample } {
  const isSend = direction === "up";
  const rtpType = isSend ? "outbound-rtp" : "inbound-rtp";

  let bytes = 0;
  let packets = 0;
  let packetsLost = 0;
  let timestamp = 0;
  let jitterMs: number | null = null;
  let rttMs: number | null = null;

  for (const report of reports) {
    if (report.type === rtpType) {
      bytes += (isSend ? report.bytesSent : report.bytesReceived) ?? 0;
      packets += (isSend ? report.packetsSent : report.packetsReceived) ?? 0;
      timestamp = Math.max(timestamp, report.timestamp ?? 0);
      if (!isSend) {
        packetsLost += report.packetsLost ?? 0;
        jitterMs = maxDefined(jitterMs, toMs(report.jitter));
      }
    } else if (isSend && report.type === "remote-inbound-rtp") {
      packetsLost += report.packetsLost ?? 0;
      jitterMs = maxDefined(jitterMs, toMs(report.jitter));
      rttMs = maxDefined(rttMs, toMs(report.roundTripTime));
    } else if (report.type === "candidate-pair" && report.nominated) {
      rttMs = maxDefined(rttMs, toMs(report.currentRoundTripTime));
    }
  }

  let bitrateKbps: number | null = null;
  let packetLoss: number;

  if (previous && timestamp > previous.timestamp) {
    const dtSeconds = (timestamp - previous.timestamp) / 1000;
    const bytesDelta = Math.max(0, bytes - previous.bytes);
    bitrateKbps = dtSeconds > 0 ? (bytesDelta * 8) / dtSeconds / 1000 : null;

    const lostDelta = Math.max(0, packetsLost - previous.packetsLost);
    const packetsDelta = Math.max(0, packets - previous.packets);
    packetLoss = fraction(lostDelta, packetsDelta);
  } else {
    packetLoss = fraction(packetsLost, packets);
  }

  return {
    stats: {
      direction,
      rttMs: rttMs === null ? null : Math.round(rttMs),
      jitterMs: jitterMs === null ? null : Math.round(jitterMs),
      packetLoss,
      bitrateKbps: bitrateKbps === null ? null : Math.round(bitrateKbps),
    },
    sample: { timestamp, bytes, packets, packetsLost },
  };
}

/**
 * Samples WebRTC stats from the local (upload) or remote (download) tracks of a
 * LiveKit room, merging every track's report before folding it down.
 */
export async function sampleNetworkStats(
  room: StatsRoom,
  direction: NetworkDirection,
  previous: NetworkStatsSample | null,
): Promise<{ stats: NetworkStats; sample: NetworkStatsSample } | null> {
  const participants =
    direction === "up" ? [room.localParticipant] : [...room.remoteParticipants.values()];

  const tracks: StatsTrack[] = [];
  for (const participant of participants) {
    for (const publication of participant.trackPublications.values()) {
      if (publication.track?.getRTCStatsReport) {
        tracks.push(publication.track);
      }
    }
  }

  if (tracks.length === 0) {
    return null;
  }

  const reports: RtcStatLike[] = [];
  for (const track of tracks) {
    const report = await track.getRTCStatsReport?.();
    if (report) {
      reports.push(...collectRtcStats(report));
    }
  }

  return computeNetworkStats(reports, direction, previous);
}

function toMs(value: number | undefined): number | undefined {
  return value === undefined ? undefined : value * 1000;
}

function maxDefined(current: number | null, next: number | undefined): number | null {
  if (next === undefined || Number.isNaN(next)) {
    return current;
  }
  return current === null ? next : Math.max(current, next);
}

function fraction(part: number, rest: number): number {
  const total = part + rest;
  return total > 0 ? part / total : 0;
}
