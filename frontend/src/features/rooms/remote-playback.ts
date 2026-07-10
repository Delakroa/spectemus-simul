import type {
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Room as LiveKitRoom,
} from "livekit-client";

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
  setElements: (elements: RemotePlaybackElements) => void;
};

export type RemotePlaybackHandlers = {
  onStateChange: (state: RemotePlaybackState) => void;
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

  const emitState = (next?: Partial<RemotePlaybackState>) => {
    if (disconnected) {
      return;
    }

    const trackCount = Number(Boolean(videoTrack)) + Number(Boolean(audioTrack));
    const status: RemotePlaybackStatus =
      next?.status ?? (trackCount > 0 ? "receiving" : hasReceivedTracks ? "lost" : "waiting");

    handlers.onStateChange({
      ...idleState,
      audioTrackName,
      error: null,
      participantIdentity,
      status,
      trackCount,
      videoTrackName,
      ...next,
    });
  };

  const attachVideo = () => {
    if (!videoTrack || !videoElement) {
      return;
    }

    videoElement.autoplay = true;
    videoElement.muted = false;
    videoElement.playsInline = true;
    videoTrack.attach(videoElement);
    void videoElement.play().catch((error: unknown) => {
      emitState({
        error: error instanceof Error ? error.message : "Не удалось воспроизвести видео.",
        status: "error",
      });
    });
  };

  const attachAudio = () => {
    if (!audioTrack || !audioElement) {
      return;
    }

    audioElement.autoplay = true;
    audioTrack.attach(audioElement);
    void audioElement.play().catch((error: unknown) => {
      emitState({
        error: error instanceof Error ? error.message : "Не удалось воспроизвести звук.",
        status: "error",
      });
    });
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

  const handleTrackSubscribed = (
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) => {
    if (track.kind !== "video" && track.kind !== "audio") {
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
      attachVideo();
      emitState();
      return;
    }

    if (audioTrack && audioTrack !== track && audioElement) {
      audioTrack.detach(audioElement);
    }

    audioTrack = track;
    audioTrackName = publication.trackName || "audio";
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
    }

    if (track === audioTrack) {
      if (audioElement) {
        track.detach(audioElement);
      }

      audioTrack = null;
      audioTrackName = null;
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
    emitState({ status: "lost" });
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
    setElements: (elements) => {
      detachCurrentTracks();
      audioElement = elements.audioElement;
      videoElement = elements.videoElement;
      attachCurrentTracks();
      emitState();
    },
  };
}
