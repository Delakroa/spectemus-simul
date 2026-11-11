import { useEffect, useRef, useState } from "react";
import type { Room as LiveKitRoom } from "livekit-client";

import {
  createGuestPlaybackStateReceiver,
  idlePlaybackState,
  type GuestPlaybackStateReceiver,
  type PlaybackStateView,
} from "../rooms/playback-state";

/**
 * Display-only sync for Internet guests.
 *
 * Receives host playback-state over LiveKit data channel, but never attaches a
 * video element: the guest WebRTC movie track is a live publish, not a seekable
 * local file. Identity of the movie publisher is required — topic alone is not
 * enough because any participant can send data messages.
 */
export function useInternetGuestPlaybackSync(options: {
  enabled: boolean;
  expectedHostIdentity: string | null;
  room: LiveKitRoom | null;
}) {
  const { enabled, expectedHostIdentity, room } = options;
  const [state, setState] = useState<PlaybackStateView>(idlePlaybackState);
  const receiverRef = useRef<GuestPlaybackStateReceiver | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!enabled || !room || !expectedHostIdentity) {
      const previous = receiverRef.current;
      receiverRef.current = null;
      previous?.disconnect();
      void Promise.resolve().then(() => {
        if (!cancelled) {
          setState(idlePlaybackState);
        }
      });
      return () => {
        cancelled = true;
      };
    }

    const receiver = createGuestPlaybackStateReceiver(room, expectedHostIdentity, {
      onStateChange: (next) => {
        if (!cancelled) {
          setState(next);
        }
      },
    });
    // Do not call setVideoElement: Internet guest media is WebRTC live, not seekable.
    receiverRef.current = receiver;

    return () => {
      cancelled = true;
      if (receiverRef.current === receiver) {
        receiverRef.current = null;
      }
      receiver.disconnect();
    };
  }, [enabled, expectedHostIdentity, room]);

  return state;
}

export function formatInternetPlaybackSyncStatus(status: PlaybackStateView["status"]) {
  switch (status) {
    case "playing":
      return "Идёт фильм";
    case "paused":
      return "Пауза";
    case "ended":
      return "Фильм закончился";
    case "ready":
      return "Готов к запуску";
    case "idle":
    default:
      return "Нет синхронизации";
  }
}

export function formatInternetPlaybackClock(seconds: number, duration: number | null) {
  const currentLabel = formatClock(seconds);
  if (duration === null || !Number.isFinite(duration)) {
    return currentLabel;
  }
  return `${currentLabel} / ${formatClock(duration)}`;
}

function formatClock(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
