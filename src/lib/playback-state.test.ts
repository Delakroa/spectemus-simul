import { describe, expect, it } from 'vitest';
import {
  createHostPlaybackStateMessage,
  decodeHostPlaybackStateMessage,
  encodeHostPlaybackStateMessage,
  playbackStateTopic
} from './playback-state';

describe('playback state messages', () => {
  it('round-trips a host playback state payload', () => {
    const message = createHostPlaybackStateMessage({
      revision: 7,
      event: 'seek',
      status: 'playing',
      currentTime: 42.5,
      duration: 120,
      sentAt: 1000,
      fileName: 'movie.mp4'
    });

    expect(playbackStateTopic).toBe('wt.playback-state.v1');
    expect(decodeHostPlaybackStateMessage(encodeHostPlaybackStateMessage(message))).toEqual(message);
  });

  it('rejects unrelated payloads', () => {
    const payload = new TextEncoder().encode(JSON.stringify({ type: 'other', version: 1 }));

    expect(decodeHostPlaybackStateMessage(payload)).toBeNull();
    expect(decodeHostPlaybackStateMessage(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('normalizes invalid media times while creating a message', () => {
    const message = createHostPlaybackStateMessage({
      revision: 1,
      event: 'metadata',
      status: 'ready',
      currentTime: Number.NaN,
      duration: Number.POSITIVE_INFINITY
    });

    expect(message.currentTime).toBe(0);
    expect(message.duration).toBe(0);
  });
});
