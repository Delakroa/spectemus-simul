import type {
  LocalAudioTrack,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Room as LiveKitRoom,
} from "livekit-client";

export const VOICE_TRACK_NAME = "voice-microphone";

export type VoiceChatStatus = "idle" | "requesting" | "live" | "muted" | "error";

export type VoicePublication = {
  track: LocalAudioTrack;
};

export type RemoteVoiceState = {
  error: string | null;
  participantIdentities: string[];
  trackCount: number;
};

export type RemoteVoiceController = {
  disconnect: () => void;
};

export type RemoteVoiceHandlers = {
  onStateChange: (state: RemoteVoiceState) => void;
};

export class VoiceChatFailure extends Error {
  constructor(
    public readonly code:
      | "LIVEKIT_NOT_CONNECTED"
      | "MIC_PERMISSION_DENIED"
      | "MIC_UNAVAILABLE"
      | "PUBLISH_FAILED"
      | "MUTE_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "VoiceChatFailure";
  }
}

const idleRemoteVoiceState: RemoteVoiceState = {
  error: null,
  participantIdentities: [],
  trackCount: 0,
};

export async function publishVoiceToLiveKit(room: LiveKitRoom): Promise<VoicePublication> {
  const { createLocalAudioTrack, Track } = await import("livekit-client");
  let track: LocalAudioTrack | null = null;

  try {
    track = await createLocalAudioTrack({
      autoGainControl: true,
      echoCancellation: true,
      noiseSuppression: true,
    });
    await room.localParticipant.publishTrack(track, {
      name: VOICE_TRACK_NAME,
      source: Track.Source.Microphone,
    });

    return { track };
  } catch (error) {
    track?.stop();
    throw normalizeVoiceError(error);
  }
}

export async function muteVoicePublication(publication: VoicePublication): Promise<void> {
  try {
    await publication.track.mute();
  } catch (error) {
    throw new VoiceChatFailure(
      "MUTE_FAILED",
      error instanceof Error ? error.message : "Не удалось выключить микрофон.",
    );
  }
}

export async function unmuteVoicePublication(publication: VoicePublication): Promise<void> {
  try {
    await publication.track.unmute();
  } catch (error) {
    throw new VoiceChatFailure(
      "MUTE_FAILED",
      error instanceof Error ? error.message : "Не удалось включить микрофон.",
    );
  }
}

export function stopVoicePublication(
  room: LiveKitRoom | null,
  publication: VoicePublication,
): void {
  try {
    if (room) {
      void room.localParticipant.unpublishTrack(publication.track, true).catch(() => {
        publication.track.stop();
      });
    } else {
      publication.track.stop();
    }
  } catch {
    publication.track.stop();
  }
}

export function createRemoteVoiceController(
  room: LiveKitRoom,
  handlers: RemoteVoiceHandlers,
): RemoteVoiceController {
  const remoteTracks = new Map<
    RemoteTrack,
    {
      audioElement: HTMLAudioElement;
      participantIdentity: string;
      trackName: string;
    }
  >();
  let disconnected = false;

  const emitState = (error: string | null = null) => {
    if (disconnected) {
      return;
    }

    handlers.onStateChange({
      error,
      participantIdentities: [
        ...new Set([...remoteTracks.values()].map((item) => item.participantIdentity)),
      ],
      trackCount: remoteTracks.size,
    });
  };

  const attachVoiceTrack = (
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) => {
    if (track.kind !== "audio" || !isVoiceTrackPublication(publication)) {
      return;
    }

    detachVoiceTrack(track);

    const audioElement = document.createElement("audio");
    audioElement.autoplay = true;
    audioElement.dataset.voiceTrack = publication.trackName || VOICE_TRACK_NAME;
    audioElement.style.display = "none";
    document.body.append(audioElement);
    track.attach(audioElement);
    remoteTracks.set(track, {
      audioElement,
      participantIdentity: participant.identity,
      trackName: publication.trackName || VOICE_TRACK_NAME,
    });

    void audioElement.play().catch((error: unknown) => {
      emitState(error instanceof Error ? error.message : "Не удалось воспроизвести голос.");
    });
    emitState();
  };

  const detachVoiceTrack = (track: RemoteTrack) => {
    const remoteTrack = remoteTracks.get(track);
    if (!remoteTrack) {
      return;
    }

    track.detach(remoteTrack.audioElement);
    remoteTrack.audioElement.remove();
    remoteTracks.delete(track);
  };

  const handleTrackSubscribed = (
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) => {
    attachVoiceTrack(track, publication, participant);
  };

  const handleTrackUnsubscribed = (track: RemoteTrack) => {
    detachVoiceTrack(track);
    emitState();
  };

  const handleParticipantDisconnected = (participant: RemoteParticipant) => {
    for (const [track, remoteTrack] of remoteTracks.entries()) {
      if (remoteTrack.participantIdentity === participant.identity) {
        detachVoiceTrack(track);
      }
    }
    emitState();
  };

  room.on("trackSubscribed", handleTrackSubscribed);
  room.on("trackUnsubscribed", handleTrackUnsubscribed);
  room.on("participantDisconnected", handleParticipantDisconnected);

  for (const participant of room.remoteParticipants.values()) {
    for (const publication of participant.trackPublications.values()) {
      if (publication.track) {
        attachVoiceTrack(publication.track, publication, participant);
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
      for (const track of remoteTracks.keys()) {
        detachVoiceTrack(track);
      }
      handlers.onStateChange(idleRemoteVoiceState);
    },
  };
}

export function isVoiceTrackPublication(publication: Pick<RemoteTrackPublication, "trackName">) {
  const source = readTrackSource(publication);
  return publication.trackName === VOICE_TRACK_NAME || source === "microphone";
}

function normalizeVoiceError(error: unknown): VoiceChatFailure {
  if (error instanceof VoiceChatFailure) {
    return error;
  }

  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return new VoiceChatFailure("MIC_PERMISSION_DENIED", "Браузер не дал доступ к микрофону.");
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return new VoiceChatFailure("MIC_UNAVAILABLE", "Микрофон не найден.");
    }
  }

  return new VoiceChatFailure(
    "PUBLISH_FAILED",
    error instanceof Error ? error.message : "Не удалось включить голосовой чат.",
  );
}

function readTrackSource(publication: Pick<RemoteTrackPublication, "trackName">) {
  const source = (publication as { source?: unknown }).source;
  return typeof source === "string" ? source : null;
}
