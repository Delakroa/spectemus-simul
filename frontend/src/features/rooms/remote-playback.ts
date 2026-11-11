import type {
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Room as LiveKitRoom,
} from "livekit-client";

import { isVoiceTrackPublication } from "./voice-chat";

export type RemotePlaybackStatus = "idle" | "waiting" | "receiving" | "lost" | "error";

export type RemotePlaybackState = {
  audioTrackName: string | null;
  error: string | null;
  participantIdentity: string | null;
  status: RemotePlaybackStatus;
  trackCount: number;
  videoTrackName: string | null;
};

export type RemotePlaybackElements = {
  audioElement: HTMLAudioElement | null;
  videoElement: HTMLVideoElement | null;
};

export type RemotePlaybackController = {
  disconnect: () => void;
  resumeAudio: () => Promise<void>;
  resumeVideo: () => Promise<void>;
  setElements: (elements: RemotePlaybackElements) => void;
};

export type RemotePlaybackHandlers = {
  onStateChange: (state: RemotePlaybackState) => void;
  /**
   * Optional publication filter. When omitted, LAN defaults apply:
   * any video; audio via isMovieAudioPublication (movie-audio / screen_share_audio / non-voice).
   */
  acceptPublication?: (track: RemoteTrack, publication: RemoteTrackPublication) => boolean;
  /**
   * When true, status stays `waiting` until a video track is attached.
   * LAN default is false (any single track counts as receiving).
   */
  receivingRequiresVideo?: boolean;
};

const idleState: RemotePlaybackState = {
  audioTrackName: null,
  error: null,
  participantIdentity: null,
  status: "idle",
  trackCount: 0,
  videoTrackName: null,
};

export function createRemotePlaybackController(
  room: LiveKitRoom,
  handlers: RemotePlaybackHandlers,
): RemotePlaybackController {
  let audioElement: HTMLAudioElement | null = null;
  let videoElement: HTMLVideoElement | null = null;
  let audioTrack: RemoteTrack | null = null;
  let videoTrack: RemoteTrack | null = null;
  let audioTrackName: string | null = null;
  let videoTrackName: string | null = null;
  let participantIdentity: string | null = null;
  let hasReceivedTracks = false;
  let disconnected = false;
  let videoPlaybackError: string | null = null;
  let audioPlaybackError: string | null = null;

  const resolveStatus = (override?: RemotePlaybackStatus): RemotePlaybackStatus => {
    if (override) {
      return override;
    }
    if (videoTrack) {
      return "receiving";
    }
    if (audioTrack) {
      return handlers.receivingRequiresVideo ? "waiting" : "receiving";
    }
    return hasReceivedTracks ? "lost" : "waiting";
  };

  const emitState = (next?: Partial<RemotePlaybackState>) => {
    if (disconnected) {
      return;
    }

    const trackCount = Number(Boolean(videoTrack)) + Number(Boolean(audioTrack));
    const error =
      next && Object.prototype.hasOwnProperty.call(next, "error")
        ? (next.error ?? null)
        : (videoPlaybackError ?? audioPlaybackError);
    const status = next?.status ?? (error ? "error" : resolveStatus());

    handlers.onStateChange({
      audioTrackName,
      error,
      participantIdentity,
      status,
      trackCount,
      videoTrackName,
    });
  };

  const emitAfterPlaybackAttempt = () => {
    const error = videoPlaybackError ?? audioPlaybackError;
    if (error) {
      emitState({ error, status: "error" });
      return;
    }
    emitState({ error: null });
  };

  const resumeAudio = async (): Promise<void> => {
    const expectedTrack = audioTrack;
    const expectedElement = audioElement;
    if (!expectedTrack || !expectedElement) {
      return;
    }

    try {
      await expectedElement.play();
      // Unsubscribe / setElements / disconnect могли сменить дорожку, пока play() висел.
      if (disconnected || audioTrack !== expectedTrack || audioElement !== expectedElement) {
        return;
      }
      audioPlaybackError = null;
      emitAfterPlaybackAttempt();
    } catch (error) {
      if (disconnected || audioTrack !== expectedTrack || audioElement !== expectedElement) {
        return;
      }
      audioPlaybackError =
        error instanceof Error ? error.message : "Не удалось воспроизвести звук.";
      emitState({
        error: videoPlaybackError ?? audioPlaybackError,
        status: "error",
      });
    }
  };

  const resumeVideo = async (): Promise<void> => {
    const expectedTrack = videoTrack;
    const expectedElement = videoElement;
    if (!expectedTrack || !expectedElement) {
      return;
    }

    try {
      await expectedElement.play();
      // Unsubscribe / setElements / disconnect могли сменить дорожку, пока play() висел.
      if (disconnected || videoTrack !== expectedTrack || videoElement !== expectedElement) {
        return;
      }
      videoPlaybackError = null;
      emitAfterPlaybackAttempt();
    } catch (error) {
      if (disconnected || videoTrack !== expectedTrack || videoElement !== expectedElement) {
        return;
      }
      videoPlaybackError = formatVideoPlaybackError(error);
      emitState({
        error: videoPlaybackError ?? audioPlaybackError,
        status: "error",
      });
    }
  };

  const attachVideo = () => {
    if (!videoTrack || !videoElement) {
      return;
    }

    videoElement.autoplay = true;
    // Звук фильма воспроизводит отдельный audio element. Mute video позволяет
    // браузеру начать remote video без обязательного клика гостя.
    videoElement.muted = true;
    videoElement.playsInline = true;
    videoTrack.attach(videoElement);
    void resumeVideo();
  };

  const attachAudio = () => {
    if (!audioTrack || !audioElement) {
      return;
    }

    audioElement.autoplay = true;
    audioTrack.attach(audioElement);
    void resumeAudio();
  };

  const detachCurrentTracks = () => {
    if (videoTrack && videoElement) {
      videoTrack.detach(videoElement);
    }

    if (audioTrack && audioElement) {
      audioTrack.detach(audioElement);
    }
  };

  const attachCurrentTracks = () => {
    attachVideo();
    attachAudio();
  };

  const acceptsPublication = (track: RemoteTrack, publication: RemoteTrackPublication) => {
    if (handlers.acceptPublication) {
      return handlers.acceptPublication(track, publication);
    }
    if (track.kind === "audio") {
      return isMovieAudioPublication(publication);
    }
    return track.kind === "video";
  };

  const handleTrackSubscribed = (
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) => {
    if (track.kind !== "video" && track.kind !== "audio") {
      return;
    }

    if (!acceptsPublication(track, publication)) {
      return;
    }

    hasReceivedTracks = true;
    participantIdentity = participant.identity;

    if (track.kind === "video") {
      if (videoTrack && videoTrack !== track && videoElement) {
        videoTrack.detach(videoElement);
      }

      videoTrack = track;
      videoTrackName = publication.trackName || "video";
      videoPlaybackError = null;
      attachVideo();
      emitState();
      return;
    }

    if (audioTrack && audioTrack !== track && audioElement) {
      audioTrack.detach(audioElement);
    }

    audioTrack = track;
    audioTrackName = publication.trackName || "audio";
    audioPlaybackError = null;
    attachAudio();
    emitState();
  };

  const handleTrackUnsubscribed = (track: RemoteTrack) => {
    if (track === videoTrack) {
      if (videoElement) {
        track.detach(videoElement);
      }

      videoTrack = null;
      videoTrackName = null;
      videoPlaybackError = null;
    }

    if (track === audioTrack) {
      if (audioElement) {
        track.detach(audioElement);
      }

      audioTrack = null;
      audioTrackName = null;
      audioPlaybackError = null;
    }

    emitState();
  };

  const handleParticipantDisconnected = (participant: RemoteParticipant) => {
    if (participant.identity !== participantIdentity) {
      return;
    }

    detachCurrentTracks();
    audioTrack = null;
    videoTrack = null;
    audioTrackName = null;
    videoTrackName = null;
    participantIdentity = null;
    videoPlaybackError = null;
    audioPlaybackError = null;
    emitState({ status: "lost", error: null });
  };

  room.on("trackSubscribed", handleTrackSubscribed);
  room.on("trackUnsubscribed", handleTrackUnsubscribed);
  room.on("participantDisconnected", handleParticipantDisconnected);

  for (const participant of room.remoteParticipants.values()) {
    for (const publication of participant.trackPublications.values()) {
      if (publication.track) {
        handleTrackSubscribed(publication.track, publication, participant);
      }
    }
  }

  emitState();

  return {
    disconnect: () => {
      disconnected = true;
      room.off("trackSubscribed", handleTrackSubscribed);
      room.off("trackUnsubscribed", handleTrackUnsubscribed);
      room.off("participantDisconnected", handleParticipantDisconnected);
      detachCurrentTracks();
      handlers.onStateChange(idleState);
    },
    resumeAudio,
    resumeVideo,
    setElements: (elements) => {
      detachCurrentTracks();
      audioElement = elements.audioElement;
      videoElement = elements.videoElement;
      attachCurrentTracks();
      emitState();
    },
  };
}

function formatVideoPlaybackError(error: unknown) {
  if (isAutoplayBlocked(error)) {
    return "Браузер ждёт явного действия для запуска видео.";
  }

  return error instanceof Error ? error.message : "Не удалось воспроизвести видео.";
}

function isAutoplayBlocked(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === "NotAllowedError" ||
    /autoplay|user (didn't|did not) interact|user gesture/i.test(error.message)
  );
}

function isMovieAudioPublication(publication: RemoteTrackPublication) {
  const source = (publication as { source?: unknown }).source;
  return (
    publication.trackName === "movie-audio" ||
    source === "screen_share_audio" ||
    !isVoiceTrackPublication(publication)
  );
}

/** Strict Internet movie tracks: name + expected LiveKit source from file publication. */
export function isStrictInternetMoviePublication(
  track: Pick<RemoteTrack, "kind">,
  publication: Pick<RemoteTrackPublication, "trackName"> & { source?: unknown },
) {
  const source = publication.source;
  if (track.kind === "video") {
    return publication.trackName === "movie-video" && source === "camera";
  }
  if (track.kind === "audio") {
    return publication.trackName === "movie-audio" && source === "screen_share_audio";
  }
  return false;
}
