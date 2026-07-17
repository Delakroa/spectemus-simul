const SEEK_COMPLETION_TIMEOUT_MS = 1_500;
const SEEK_EPSILON_SECONDS = 0.01;

type SeekableVideoElement = Pick<
  HTMLVideoElement,
  "addEventListener" | "currentTime" | "duration" | "removeEventListener" | "seeking"
>;

export type HostSeekController = {
  dispose: () => void;
  seek: (seconds: number, onComplete?: () => void) => void;
};

type QueuedHostSeek = {
  onComplete?: () => void;
  seconds: number;
};

/**
 * Serialises seeks to one local media element.
 *
 * Browsers apply `currentTime` asynchronously. Writing it repeatedly while a
 * previous seek is still pending can leave a captureStream-backed preview in
 * an inconsistent state. Keeping only the newest target preserves the intent
 * of a fast scrub without queueing every intermediate frame.
 */
export function createHostSeekController(videoElement: SeekableVideoElement): HostSeekController {
  let disposed = false;
  let activeSeekComplete: (() => void) | undefined;
  let queuedSeek: QueuedHostSeek | null = null;
  let seekCompletionTimer: number | null = null;
  let seekInFlight = false;

  const clearSeekCompletionTimer = () => {
    if (seekCompletionTimer !== null) {
      window.clearTimeout(seekCompletionTimer);
      seekCompletionTimer = null;
    }
  };

  const toSeekTarget = (seconds: number) => {
    const lowerBounded = Math.max(0, seconds);

    if (!Number.isFinite(videoElement.duration) || videoElement.duration <= 0) {
      return lowerBounded;
    }

    return Math.min(lowerBounded, Math.max(0, videoElement.duration - SEEK_EPSILON_SECONDS));
  };

  const flush = () => {
    if (disposed || seekInFlight || queuedSeek === null || videoElement.seeking) {
      return;
    }

    const nextSeek = queuedSeek;
    const target = toSeekTarget(nextSeek.seconds);
    queuedSeek = null;
    activeSeekComplete = nextSeek.onComplete;

    if (Math.abs(videoElement.currentTime - target) < SEEK_EPSILON_SECONDS) {
      const onComplete = activeSeekComplete;
      activeSeekComplete = undefined;
      onComplete?.();
      flush();
      return;
    }

    seekInFlight = true;
    videoElement.currentTime = target;
    seekCompletionTimer = window.setTimeout(() => {
      seekCompletionTimer = null;
      seekInFlight = false;
      activeSeekComplete = undefined;
      flush();
    }, SEEK_COMPLETION_TIMEOUT_MS);
  };

  const handleSeeked = () => {
    clearSeekCompletionTimer();
    seekInFlight = false;
    const onComplete = queuedSeek === null ? activeSeekComplete : undefined;
    activeSeekComplete = undefined;
    onComplete?.();
    flush();
  };

  videoElement.addEventListener("seeked", handleSeeked);

  return {
    dispose: () => {
      disposed = true;
      activeSeekComplete = undefined;
      queuedSeek = null;
      clearSeekCompletionTimer();
      videoElement.removeEventListener("seeked", handleSeeked);
    },
    seek: (seconds, onComplete) => {
      if (disposed || !Number.isFinite(seconds)) {
        return;
      }

      queuedSeek = { onComplete, seconds };
      flush();
    },
  };
}
