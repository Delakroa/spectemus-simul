export const playbackStateTopic = 'wt.playback-state.v1';

export type HostPlaybackStatus = 'idle' | 'ready' | 'playing' | 'paused' | 'ended';

export type HostPlaybackEvent =
  | 'metadata'
  | 'play'
  | 'pause'
  | 'seek'
  | 'heartbeat'
  | 'publish'
  | 'stop'
  | 'participant'
  | 'reconnect';

export type HostPlaybackStateMessage = {
  type: 'wt.playback-state';
  version: 1;
  revision: number;
  event: HostPlaybackEvent;
  status: HostPlaybackStatus;
  currentTime: number;
  duration: number | null;
  sentAt: number;
  fileName: string | null;
};

export function createHostPlaybackStateMessage(input: {
  revision: number;
  event: HostPlaybackEvent;
  status: HostPlaybackStatus;
  currentTime: number;
  duration: number | null;
  sentAt?: number;
  fileName?: string | null;
}): HostPlaybackStateMessage {
  return {
    type: 'wt.playback-state',
    version: 1,
    revision: input.revision,
    event: input.event,
    status: input.status,
    currentTime: normalizeTime(input.currentTime),
    duration: input.duration === null ? null : normalizeTime(input.duration),
    sentAt: input.sentAt ?? Date.now(),
    fileName: input.fileName ?? null
  };
}

export function encodeHostPlaybackStateMessage(message: HostPlaybackStateMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(message));
}

export function decodeHostPlaybackStateMessage(payload: Uint8Array): HostPlaybackStateMessage | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(payload));

    if (!isHostPlaybackStateMessage(value)) {
      return null;
    }

    return value;
  } catch {
    return null;
  }
}

function isHostPlaybackStateMessage(value: unknown): value is HostPlaybackStateMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<HostPlaybackStateMessage>;

  return candidate.type === 'wt.playback-state'
    && candidate.version === 1
    && isFiniteNumber(candidate.revision)
    && isHostPlaybackEvent(candidate.event)
    && isHostPlaybackStatus(candidate.status)
    && isFiniteNumber(candidate.currentTime)
    && (candidate.duration === null || isFiniteNumber(candidate.duration))
    && isFiniteNumber(candidate.sentAt)
    && (candidate.fileName === null || typeof candidate.fileName === 'string');
}

function isHostPlaybackStatus(value: unknown): value is HostPlaybackStatus {
  return value === 'idle' || value === 'ready' || value === 'playing' || value === 'paused' || value === 'ended';
}

function isHostPlaybackEvent(value: unknown): value is HostPlaybackEvent {
  return value === 'metadata'
    || value === 'play'
    || value === 'pause'
    || value === 'seek'
    || value === 'heartbeat'
    || value === 'publish'
    || value === 'stop'
    || value === 'participant'
    || value === 'reconnect';
}

function normalizeTime(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
