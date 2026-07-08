import { describe, expect, it, vi } from 'vitest';
import {
  captureMediaElementStream,
  cleanupObjectUrl,
  detectSupportedMimeType,
  getPrimaryPublishTracks,
  hasCaptureStreamSupport,
  stopMediaTracks
} from './media';

describe('media helpers', () => {
  it('detects the first playable MP4 MIME candidate', () => {
    const canPlayType = vi.fn((mimeType: string) => (mimeType.includes('avc1.4D401F') ? 'probably' : ''));

    expect(detectSupportedMimeType(canPlayType)).toBe('video/mp4; codecs="avc1.4D401F, mp4a.40.2"');
  });

  it('returns null when no MIME candidate is supported', () => {
    expect(detectSupportedMimeType(() => '')).toBeNull();
  });

  it('revokes an existing object URL and returns null', () => {
    const revokeObjectUrl = vi.fn();

    expect(cleanupObjectUrl('blob:http://local/video', revokeObjectUrl)).toBeNull();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:http://local/video');
  });

  it('stops all supplied media tracks', () => {
    const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];

    stopMediaTracks(tracks);

    expect(tracks[0].stop).toHaveBeenCalledOnce();
    expect(tracks[1].stop).toHaveBeenCalledOnce();
  });

  it('allows publishing without an audio track when video is present', () => {
    const videoTrack = createTrack('video');
    const stream = {
      getVideoTracks: () => [videoTrack],
      getAudioTracks: () => []
    };

    const result = getPrimaryPublishTracks(stream);

    expect(result.videoTrack).toBe(videoTrack);
    expect(result.audioTrack).toBeNull();
    expect(result.summary.hasAudio).toBe(false);
    expect(result.summary.hasVideo).toBe(true);
  });

  it('throws a clear error when captureStream is missing', () => {
    expect(hasCaptureStreamSupport({})).toBe(false);
    expect(() => captureMediaElementStream({} as HTMLMediaElement)).toThrow(/captureStream/);
  });
});

function createTrack(kind: MediaStreamTrack['kind']): MediaStreamTrack {
  return {
    kind,
    label: `${kind}-track`,
    readyState: 'live',
    stop: vi.fn()
  } as unknown as MediaStreamTrack;
}
