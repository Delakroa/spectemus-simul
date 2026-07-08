import { createPocError } from './errors';

export type CanPlayTypeResult = '' | 'maybe' | 'probably';

export type CapturableMediaElement = HTMLMediaElement & {
  captureStream?: () => MediaStream;
};

export type StreamTrackSummary = {
  videoTracks: MediaStreamTrack[];
  audioTracks: MediaStreamTrack[];
  hasVideo: boolean;
  hasAudio: boolean;
};

export const supportedMp4MimeCandidates = [
  'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
  'video/mp4; codecs="avc1.4D401F, mp4a.40.2"',
  'video/mp4; codecs="avc1.64001F, mp4a.40.2"',
  'video/mp4'
] as const;

export function detectSupportedMimeType(
  canPlayType: (mimeType: string) => CanPlayTypeResult,
  candidates: readonly string[] = supportedMp4MimeCandidates
): string | null {
  return candidates.find((mimeType) => isPlayable(canPlayType(mimeType))) ?? null;
}

export function isPlayable(result: CanPlayTypeResult): boolean {
  return result === 'probably' || result === 'maybe';
}

export function cleanupObjectUrl(
  objectUrl: string | null | undefined,
  revokeObjectUrl: (objectUrl: string) => void = URL.revokeObjectURL
): null {
  if (objectUrl) {
    revokeObjectUrl(objectUrl);
  }

  return null;
}

export function stopMediaTracks(tracks: Iterable<Pick<MediaStreamTrack, 'stop'>> | null | undefined): void {
  if (!tracks) {
    return;
  }

  for (const track of tracks) {
    track.stop();
  }
}

export function summarizeStreamTracks(stream: Pick<MediaStream, 'getVideoTracks' | 'getAudioTracks'>): StreamTrackSummary {
  const videoTracks = stream.getVideoTracks();
  const audioTracks = stream.getAudioTracks();

  return {
    videoTracks,
    audioTracks,
    hasVideo: videoTracks.length > 0,
    hasAudio: audioTracks.length > 0
  };
}

export function getPrimaryPublishTracks(stream: Pick<MediaStream, 'getVideoTracks' | 'getAudioTracks'>): {
  videoTrack: MediaStreamTrack;
  audioTrack: MediaStreamTrack | null;
  summary: StreamTrackSummary;
} {
  const summary = summarizeStreamTracks(stream);
  const videoTrack = summary.videoTracks[0];

  if (!videoTrack) {
    throw createPocError('VIDEO_TRACK_MISSING', 'Captured stream does not contain a video track.', {
      recoverable: true
    });
  }

  return {
    videoTrack,
    audioTrack: summary.audioTracks[0] ?? null,
    summary
  };
}

export function captureMediaElementStream(element: CapturableMediaElement): MediaStream {
  const captureStream = element.captureStream;

  if (typeof captureStream !== 'function') {
    throw createPocError(
      'CAPTURE_STREAM_UNSUPPORTED',
      'HTMLMediaElement.captureStream() is not supported in this browser.',
      { recoverable: false }
    );
  }

  return captureStream.call(element);
}

export function hasCaptureStreamSupport(element: Partial<CapturableMediaElement> | null | undefined): element is CapturableMediaElement {
  return typeof element?.captureStream === 'function';
}

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) {
    return 'unknown size';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
