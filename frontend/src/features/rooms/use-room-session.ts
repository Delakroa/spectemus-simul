import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  closeRoom,
  createRoom,
  getRoom,
  joinRoom,
  leaveRoom,
  mintLiveKitToken,
  resolveRoomEventsUrl,
  roomIdSchema,
  ApiProblemError,
  type Participant,
  type RoomSnapshot,
} from "./room-api";
import {
  connectLiveKitRoom,
  type LiveKitConnection,
  type LiveKitConnectionStatus,
} from "./livekit-connection";
import {
  applyRoomServerEvent,
  describeRoomServerEvent,
  isKnownRoomServerEvent,
  parseRoomServerEvent,
  type KnownRoomServerEvent,
  type RoomServerEvent,
} from "./room-events";
import {
  diagnoseFile,
  FileDiagnosticsFailure,
  type FileDiagnosticsResult,
} from "./file-diagnostics";
import {
  FilePublicationFailure,
  publishFileToLiveKit,
  stopFilePublication as stopLiveKitFilePublication,
  type FilePublication,
} from "./file-publication";
import {
  createRemotePlaybackController,
  type RemotePlaybackController,
  type RemotePlaybackElements,
  type RemotePlaybackStatus,
} from "./remote-playback";
import {
  createRemoteVoiceController,
  muteVoicePublication,
  publishVoiceToLiveKit,
  stopVoicePublication as stopLiveKitVoicePublication,
  unmuteVoicePublication,
  VoiceChatFailure,
  type RemoteVoiceController,
  type VoiceChatStatus,
  type VoicePublication,
} from "./voice-chat";
import {
  createGuestPlaybackStateReceiver,
  createHostPlaybackStatePublisher,
  type GuestPlaybackStateReceiver,
  type HostPlaybackStatePublisher,
  type PlaybackEvent,
  type PlaybackStatus,
} from "./playback-state";
import {
  createMediaRecoverySignalController,
  type MediaRecoveryRequest,
  type MediaRecoverySignalController,
  type MediaRecoveryStatus,
} from "./media-recovery-signal";
import { createHostSeekController, type HostSeekController } from "./host-seek-controller";
import {
  createQualityIndicatorController,
  idleQualityIndicatorsState,
  type QualityIndicatorController,
  type QualityIndicatorsState,
} from "./quality-indicators";
import { createRoomTelemetryTracker, type RoomTelemetryTracker } from "../telemetry/telemetry";
import { submitTelemetry } from "../telemetry/telemetry-api";

const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_EVENT_LOG_ITEMS = 8;
const MAX_CHAT_MESSAGES = 200;
const MAX_CHAT_MESSAGE_LENGTH = 1000;
const HOST_SECRET_STORAGE_PREFIX = "watch-together.host-secret.";
const MAX_ROOM_RECONNECT_ATTEMPTS = 10;
const ROOM_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 15_000] as const;
// Server closes the room WebSocket with a normal code (1000) on intentional
// shutdown (room.closed, participant.left) — those must not trigger a reconnect.
const NORMAL_WS_CLOSE_CODE = 1000;

function createHostPlaybackCheckpoint(videoElement: HTMLVideoElement): HostPlaybackCheckpoint {
  const duration = Number.isFinite(videoElement.duration) ? videoElement.duration : null;
  const currentTime = Number.isFinite(videoElement.currentTime) ? videoElement.currentTime : 0;
  const startAtSeconds =
    duration === null ? Math.max(0, currentTime) : Math.min(Math.max(0, currentTime), duration);

  return {
    startAtSeconds,
    startPaused: videoElement.paused || videoElement.ended,
  };
}

export type RoomConnectionStatus =
  "idle" | "connecting" | "open" | "reconnecting" | "closed" | "error";
export type RoomActionStatus = "create" | "join" | "restore" | "leave" | "close" | null;
export type FileStatus = "idle" | "checking" | "ready" | "error";
export type FilePublicationStatus = "idle" | "publishing" | "restarting" | "live" | "error";
export type HostPlaybackStatus = "idle" | "playing" | "paused" | "ended";
export type MediaRecoveryRequestStatus = "idle" | "sending" | "sent" | "unanswered" | "error";
export type MediaRecoveryHostStatus = "idle" | MediaRecoveryStatus;
export type RoomUserErrorArea = "room" | "websocket" | "livekit";
export type RoomUserErrorAction = "retry-room-action" | "retry-websocket" | "retry-livekit";

export type RoomUserError = {
  action: RoomUserErrorAction | null;
  area: RoomUserErrorArea;
  code?: string;
  correlationId?: string;
  instance?: string;
  message: string;
  retryable: boolean;
  status?: number;
  title: string;
};

export type {
  FileDiagnosticsResult,
  PlaybackStatus,
  QualityIndicatorsState,
  RemotePlaybackElements,
  RemotePlaybackStatus,
  VoiceChatStatus,
};

export type RoomEventLogEntry = {
  eventId: string;
  label: string;
  occurredAt: string;
  type: string;
};

export type ChatMessageEntry = {
  id: string;
  kind: "user" | "system";
  participantId: string | null;
  displayName: string | null;
  text: string;
  sentAt: string;
};

type ConnectRoomEventsOptions = {
  preserveChat?: boolean;
  reconnect?: boolean;
};

type LastRoomAction =
  | { type: "create"; hostDisplayName: string }
  | { type: "join"; displayName: string; roomId: string }
  | { type: "restore"; roomId: string }
  | { type: "leave" }
  | { type: "close" };

type HostPlaybackCheckpoint = {
  startAtSeconds: number;
  startPaused: boolean;
};

type PublishFileOptions = {
  checkpoint?: HostPlaybackCheckpoint;
  recoveryRequestId?: string;
  recoveryRecipientIdentity?: string;
  status?: Extract<FilePublicationStatus, "publishing" | "restarting">;
};

export type RoomSessionState = {
  chatError: string | null;
  chatMessages: ChatMessageEntry[];
  connectionStatus: RoomConnectionStatus;
  error: string | null;
  events: RoomEventLogEntry[];
  fileError: string | null;
  filePublicationError: string | null;
  filePublicationStatus: FilePublicationStatus;
  filePublicationTrackCount: number;
  fileResult: FileDiagnosticsResult | null;
  fileStatus: FileStatus;
  hostPlaybackCurrentTime: number;
  hostPlaybackDuration: number | null;
  hostPlaybackError: string | null;
  hostPlaybackStatus: HostPlaybackStatus;
  hostReconnectDeadline: string | null;
  hostSecret: string | null;
  invitePath: string | null;
  liveKitError: string | null;
  liveKitStatus: LiveKitConnectionStatus;
  mediaRecoveryAlert: MediaRecoveryRequest | null;
  mediaRecoveryHostStatus: MediaRecoveryHostStatus;
  mediaRecoveryRequestError: string | null;
  mediaRecoveryRequestStatus: MediaRecoveryRequestStatus;
  participant: Participant | null;
  pendingAction: RoomActionStatus;
  playbackSyncCurrentTime: number;
  playbackSyncDuration: number | null;
  playbackSyncError: string | null;
  playbackSyncEvent: PlaybackEvent | null;
  playbackSyncFileName: string | null;
  playbackSyncParticipantIdentity: string | null;
  playbackSyncReceivedAt: string | null;
  playbackSyncRevision: number;
  playbackSyncSentAt: string | null;
  playbackSyncStatus: PlaybackStatus;
  qualityIndicators: QualityIndicatorsState;
  remotePlaybackAudioTrackName: string | null;
  remotePlaybackError: string | null;
  remotePlaybackParticipantIdentity: string | null;
  remotePlaybackStatus: RemotePlaybackStatus;
  remotePlaybackTrackCount: number;
  remotePlaybackVideoTrackName: string | null;
  room: RoomSnapshot | null;
  userError: RoomUserError | null;
  voiceError: string | null;
  voiceRemoteError: string | null;
  voiceRemoteParticipantCount: number;
  voiceRemoteParticipantIdentities: string[];
  voiceStatus: VoiceChatStatus;
};

const initialState: RoomSessionState = {
  chatError: null,
  chatMessages: [],
  connectionStatus: "idle",
  error: null,
  events: [],
  fileError: null,
  filePublicationError: null,
  filePublicationStatus: "idle",
  filePublicationTrackCount: 0,
  fileResult: null,
  fileStatus: "idle",
  hostPlaybackCurrentTime: 0,
  hostPlaybackDuration: null,
  hostPlaybackError: null,
  hostPlaybackStatus: "idle",
  hostReconnectDeadline: null,
  hostSecret: null,
  invitePath: null,
  liveKitError: null,
  liveKitStatus: "idle",
  mediaRecoveryAlert: null,
  mediaRecoveryHostStatus: "idle",
  mediaRecoveryRequestError: null,
  mediaRecoveryRequestStatus: "idle",
  participant: null,
  pendingAction: null,
  playbackSyncCurrentTime: 0,
  playbackSyncDuration: null,
  playbackSyncError: null,
  playbackSyncEvent: null,
  playbackSyncFileName: null,
  playbackSyncParticipantIdentity: null,
  playbackSyncReceivedAt: null,
  playbackSyncRevision: 0,
  playbackSyncSentAt: null,
  playbackSyncStatus: "idle",
  qualityIndicators: idleQualityIndicatorsState,
  remotePlaybackAudioTrackName: null,
  remotePlaybackError: null,
  remotePlaybackParticipantIdentity: null,
  remotePlaybackStatus: "idle",
  remotePlaybackTrackCount: 0,
  remotePlaybackVideoTrackName: null,
  room: null,
  userError: null,
  voiceError: null,
  voiceRemoteError: null,
  voiceRemoteParticipantCount: 0,
  voiceRemoteParticipantIdentities: [],
  voiceStatus: "idle",
};

export function useRoomSession(routeRoomId?: string) {
  const [state, setState] = useState<RoomSessionState>(initialState);
  const connectRoomEventsRef = useRef<
    | ((room: RoomSnapshot, participant: Participant, options?: ConnectRoomEventsOptions) => void)
    | null
  >(null);
  const fileDiagnosticsRequestIdRef = useRef(0);
  const fileObjectUrlRef = useRef<string | null>(null);
  const hostPlaybackCleanupRef = useRef<(() => void) | null>(null);
  const hostSeekControllerRef = useRef<HostSeekController | null>(null);
  const hostPreviewElementRef = useRef<HTMLVideoElement | null>(null);
  const hostPublicationRecoveryRequestedRef = useRef(false);
  const hostPlaybackRecoveryCheckpointRef = useRef<HostPlaybackCheckpoint | null>(null);
  const filePublicationRef = useRef<FilePublication | null>(null);
  const filePublicationRequestIdRef = useRef(0);
  const heartbeatTimerRef = useRef<number | null>(null);
  const liveKitConnectionRef = useRef<LiveKitConnection | null>(null);
  const liveKitRequestIdRef = useRef(0);
  const mediaRecoverySignalControllerRef = useRef<MediaRecoverySignalController | null>(null);
  const lastRoomActionRef = useRef<LastRoomAction | null>(null);
  const participantRef = useRef<Participant | null>(null);
  const pendingActionRef = useRef<RoomActionStatus>(null);
  const playbackStatePublisherRef = useRef<HostPlaybackStatePublisher | null>(null);
  const playbackStateReceiverRef = useRef<GuestPlaybackStateReceiver | null>(null);
  const qualityIndicatorControllerRef = useRef<QualityIndicatorController | null>(null);
  const remotePlaybackControllerRef = useRef<RemotePlaybackController | null>(null);
  const remotePlaybackElementsRef = useRef<RemotePlaybackElements>({
    audioElement: null,
    videoElement: null,
  });
  const remoteVoiceControllerRef = useRef<RemoteVoiceController | null>(null);
  const restoredRouteRoomIdRef = useRef<string | null>(null);
  const roomRef = useRef<RoomSnapshot | null>(null);
  const socketReconnectAttemptRef = useRef(0);
  const socketReconnectTimerRef = useRef<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const voicePublicationRef = useRef<VoicePublication | null>(null);
  const voiceRequestIdRef = useRef(0);
  const telemetryTrackerRef = useRef<RoomTelemetryTracker | null>(null);
  if (telemetryTrackerRef.current === null) {
    telemetryTrackerRef.current = createRoomTelemetryTracker({
      emit: (event) => {
        // Telemetry is best-effort: never let a failed beacon surface to the user.
        void submitTelemetry({ events: [event] }).catch(() => {});
      },
      getRoomId: () => roomRef.current?.roomId ?? null,
      getRole: () => participantRef.current?.role ?? null,
    });
  }

  useEffect(() => {
    participantRef.current = state.participant;
    pendingActionRef.current = state.pendingAction;
    roomRef.current = state.room;
  }, [state.participant, state.pendingAction, state.room]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current !== null) {
      window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const clearSocketReconnectTimer = useCallback(() => {
    if (socketReconnectTimerRef.current !== null) {
      window.clearTimeout(socketReconnectTimerRef.current);
      socketReconnectTimerRef.current = null;
    }
  }, []);

  const resetSocketReconnect = useCallback(() => {
    clearSocketReconnectTimer();
    socketReconnectAttemptRef.current = 0;
  }, [clearSocketReconnectTimer]);

  const revokeFileUrl = useCallback(() => {
    if (fileObjectUrlRef.current) {
      URL.revokeObjectURL(fileObjectUrlRef.current);
      fileObjectUrlRef.current = null;
    }
  }, []);

  const disconnectRemotePlayback = useCallback(() => {
    const controller = remotePlaybackControllerRef.current;
    remotePlaybackControllerRef.current = null;
    controller?.disconnect();

    setState((current) => ({
      ...current,
      remotePlaybackAudioTrackName: null,
      remotePlaybackError: null,
      remotePlaybackParticipantIdentity: null,
      remotePlaybackStatus: "idle",
      remotePlaybackTrackCount: 0,
      remotePlaybackVideoTrackName: null,
    }));
  }, []);

  const disconnectRemoteVoice = useCallback(() => {
    const controller = remoteVoiceControllerRef.current;
    remoteVoiceControllerRef.current = null;
    controller?.disconnect();

    setState((current) => ({
      ...current,
      voiceRemoteError: null,
      voiceRemoteParticipantCount: 0,
      voiceRemoteParticipantIdentities: [],
    }));
  }, []);

  const stopCurrentVoicePublication = useCallback(() => {
    const publication = voicePublicationRef.current;
    voicePublicationRef.current = null;

    if (publication) {
      stopLiveKitVoicePublication(liveKitConnectionRef.current?.room ?? null, publication);
    }
  }, []);

  const resetPlaybackSyncState = useCallback(() => {
    setState((current) => ({
      ...current,
      playbackSyncCurrentTime: 0,
      playbackSyncDuration: null,
      playbackSyncError: null,
      playbackSyncEvent: null,
      playbackSyncFileName: null,
      playbackSyncParticipantIdentity: null,
      playbackSyncReceivedAt: null,
      playbackSyncRevision: 0,
      playbackSyncSentAt: null,
      playbackSyncStatus: "idle",
    }));
  }, []);

  const stopPlaybackStatePublisher = useCallback((event: PlaybackEvent = "stop") => {
    const publisher = playbackStatePublisherRef.current;
    playbackStatePublisherRef.current = null;
    publisher?.disconnect(event);
  }, []);

  const disconnectPlaybackStateReceiver = useCallback(() => {
    const receiver = playbackStateReceiverRef.current;
    playbackStateReceiverRef.current = null;
    receiver?.disconnect();
    resetPlaybackSyncState();
  }, [resetPlaybackSyncState]);

  const disconnectQualityIndicators = useCallback(() => {
    const controller = qualityIndicatorControllerRef.current;
    qualityIndicatorControllerRef.current = null;
    controller?.disconnect();

    setState((current) => ({
      ...current,
      qualityIndicators: idleQualityIndicatorsState,
    }));
  }, []);

  const disconnectMediaRecoverySignals = useCallback(() => {
    const controller = mediaRecoverySignalControllerRef.current;
    mediaRecoverySignalControllerRef.current = null;
    controller?.disconnect();

    setState((current) => ({
      ...current,
      mediaRecoveryAlert: null,
      mediaRecoveryHostStatus: "idle",
      mediaRecoveryRequestError: null,
      mediaRecoveryRequestStatus: "idle",
    }));
  }, []);

  const setRemotePlaybackElements = useCallback((elements: RemotePlaybackElements) => {
    remotePlaybackElementsRef.current = elements;
    remotePlaybackControllerRef.current?.setElements(elements);
    playbackStateReceiverRef.current?.setVideoElement(elements.videoElement);
  }, []);

  const resumeRemotePlaybackAudio = useCallback(async () => {
    await remotePlaybackControllerRef.current?.resumeAudio();
  }, []);

  const requestMediaRecovery = useCallback(async () => {
    if (participantRef.current?.role !== "GUEST") {
      return;
    }

    const controller = mediaRecoverySignalControllerRef.current;
    if (!controller) {
      setState((current) => ({
        ...current,
        mediaRecoveryRequestError: "Подключение к просмотру ещё не готово.",
        mediaRecoveryRequestStatus: "error",
      }));
      return;
    }

    setState((current) => ({
      ...current,
      mediaRecoveryHostStatus: "idle",
      mediaRecoveryRequestError: null,
      mediaRecoveryRequestStatus: "sending",
    }));

    try {
      await controller.requestRecovery();
      telemetryTrackerRef.current?.onRecoveryRequested();
      setState((current) => ({
        ...current,
        mediaRecoveryRequestError: null,
        mediaRecoveryRequestStatus: "sent",
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        mediaRecoveryRequestError: getErrorMessage(error),
        mediaRecoveryRequestStatus: "error",
      }));
    }
  }, []);

  const detachHostPreview = useCallback((videoElement: HTMLVideoElement | null) => {
    if (!videoElement) {
      return;
    }

    videoElement.pause();
    videoElement.removeAttribute("src");
    videoElement.srcObject = null;
    videoElement.load();
  }, []);

  const attachHostPreview = useCallback((publication: FilePublication | null) => {
    const videoElement = hostPreviewElementRef.current;
    if (!videoElement || !publication) {
      return;
    }

    videoElement.autoplay = true;
    videoElement.muted = false;
    videoElement.playsInline = true;
    videoElement.srcObject = publication.stream;
    void videoElement.play().catch((error: unknown) => {
      if (isBenignPlayInterruption(error)) {
        return;
      }

      setState((current) => ({
        ...current,
        hostPlaybackError:
          error instanceof Error ? error.message : "Не удалось показать локальный preview.",
      }));
    });
  }, []);

  const setHostPreviewElement = useCallback(
    (videoElement: HTMLVideoElement | null) => {
      if (hostPreviewElementRef.current && hostPreviewElementRef.current !== videoElement) {
        detachHostPreview(hostPreviewElementRef.current);
      }

      hostPreviewElementRef.current = videoElement;

      if (videoElement) {
        attachHostPreview(filePublicationRef.current);
      }
    },
    [attachHostPreview, detachHostPreview],
  );

  const stopHostPlaybackTracking = useCallback(() => {
    const seekController = hostSeekControllerRef.current;
    hostSeekControllerRef.current = null;
    seekController?.dispose();
    const cleanup = hostPlaybackCleanupRef.current;
    hostPlaybackCleanupRef.current = null;
    cleanup?.();
    setState((current) => ({
      ...current,
      hostPlaybackCurrentTime: 0,
      hostPlaybackDuration: null,
      hostPlaybackError: null,
      hostPlaybackStatus: "idle",
    }));
  }, []);

  const stopCurrentFilePublication = useCallback(() => {
    const publication = filePublicationRef.current;
    filePublicationRef.current = null;
    detachHostPreview(hostPreviewElementRef.current);
    stopPlaybackStatePublisher();
    stopHostPlaybackTracking();

    if (publication) {
      stopLiveKitFilePublication(liveKitConnectionRef.current?.room ?? null, publication);
    }
  }, [detachHostPreview, stopHostPlaybackTracking, stopPlaybackStatePublisher]);

  const stopFilePublication = useCallback(() => {
    hostPublicationRecoveryRequestedRef.current = false;
    hostPlaybackRecoveryCheckpointRef.current = null;
    filePublicationRequestIdRef.current += 1;
    stopCurrentFilePublication();
    setState((current) => ({
      ...current,
      filePublicationError: null,
      filePublicationStatus: "idle",
      filePublicationTrackCount: 0,
    }));
  }, [stopCurrentFilePublication]);

  const clearFileState = useCallback(() => {
    hostPublicationRecoveryRequestedRef.current = false;
    hostPlaybackRecoveryCheckpointRef.current = null;
    fileDiagnosticsRequestIdRef.current += 1;
    filePublicationRequestIdRef.current += 1;
    stopCurrentFilePublication();
    revokeFileUrl();
    setState((current) => ({
      ...current,
      fileError: null,
      filePublicationError: null,
      filePublicationStatus: "idle",
      filePublicationTrackCount: 0,
      fileResult: null,
      fileStatus: "idle",
    }));
  }, [revokeFileUrl, stopCurrentFilePublication]);

  const selectFile = useCallback(
    async (file: File) => {
      hostPublicationRecoveryRequestedRef.current = false;
      hostPlaybackRecoveryCheckpointRef.current = null;
      const requestId = fileDiagnosticsRequestIdRef.current + 1;
      fileDiagnosticsRequestIdRef.current = requestId;
      filePublicationRequestIdRef.current += 1;
      stopCurrentFilePublication();
      revokeFileUrl();
      setState((current) => ({
        ...current,
        fileError: null,
        filePublicationError: null,
        filePublicationStatus: "idle",
        filePublicationTrackCount: 0,
        fileResult: null,
        fileStatus: "checking",
      }));

      try {
        const result = await diagnoseFile(file);
        if (fileDiagnosticsRequestIdRef.current !== requestId) {
          URL.revokeObjectURL(result.objectUrl);
          return;
        }

        fileObjectUrlRef.current = result.objectUrl;
        setState((current) => ({
          ...current,
          fileError: null,
          filePublicationError: null,
          filePublicationStatus: "idle",
          filePublicationTrackCount: 0,
          fileResult: result,
          fileStatus: "ready",
        }));
      } catch (error) {
        if (fileDiagnosticsRequestIdRef.current !== requestId) {
          return;
        }

        const message =
          error instanceof FileDiagnosticsFailure ? error.message : "Не удалось проверить файл.";
        setState((current) => ({
          ...current,
          fileError: message,
          filePublicationError: null,
          filePublicationStatus: "idle",
          filePublicationTrackCount: 0,
          fileResult: null,
          fileStatus: "error",
        }));
      }
    },
    [revokeFileUrl, stopCurrentFilePublication],
  );

  const startHostPlaybackTracking = useCallback((videoElement: HTMLVideoElement) => {
    const previousSeekController = hostSeekControllerRef.current;
    hostSeekControllerRef.current = null;
    previousSeekController?.dispose();
    const previousCleanup = hostPlaybackCleanupRef.current;
    hostPlaybackCleanupRef.current = null;
    previousCleanup?.();

    const handlePlay = () =>
      setState((current) => ({
        ...current,
        hostPlaybackError: null,
        hostPlaybackStatus: "playing",
      }));

    const handlePause = () =>
      setState((current) => ({
        ...current,
        hostPlaybackStatus: videoElement.ended ? "ended" : "paused",
      }));

    const handleEnded = () => setState((current) => ({ ...current, hostPlaybackStatus: "ended" }));

    const handleTimeUpdate = () =>
      setState((current) => ({
        ...current,
        hostPlaybackCurrentTime: videoElement.currentTime,
      }));

    const handleDurationChange = () =>
      setState((current) => ({
        ...current,
        hostPlaybackDuration: Number.isFinite(videoElement.duration) ? videoElement.duration : null,
      }));

    videoElement.addEventListener("play", handlePlay);
    videoElement.addEventListener("pause", handlePause);
    videoElement.addEventListener("ended", handleEnded);
    videoElement.addEventListener("timeupdate", handleTimeUpdate);
    videoElement.addEventListener("durationchange", handleDurationChange);
    const seekController = createHostSeekController(videoElement);
    hostSeekControllerRef.current = seekController;

    hostPlaybackCleanupRef.current = () => {
      seekController.dispose();
      if (hostSeekControllerRef.current === seekController) {
        hostSeekControllerRef.current = null;
      }
      videoElement.removeEventListener("play", handlePlay);
      videoElement.removeEventListener("pause", handlePause);
      videoElement.removeEventListener("ended", handleEnded);
      videoElement.removeEventListener("timeupdate", handleTimeUpdate);
      videoElement.removeEventListener("durationchange", handleDurationChange);
    };

    setState((current) => ({
      ...current,
      hostPlaybackCurrentTime: videoElement.currentTime,
      hostPlaybackDuration: Number.isFinite(videoElement.duration) ? videoElement.duration : null,
      hostPlaybackError: null,
      hostPlaybackStatus: videoElement.ended ? "ended" : videoElement.paused ? "paused" : "playing",
    }));
  }, []);

  const hostPlay = useCallback(async () => {
    const publication = filePublicationRef.current;
    if (!publication) {
      return;
    }

    try {
      await publication.videoElement.play();
      attachHostPreview(publication);
    } catch (error) {
      if (isBenignPlayInterruption(error)) {
        setState((current) => ({
          ...current,
          hostPlaybackError: null,
        }));
        return;
      }

      setState((current) => ({
        ...current,
        hostPlaybackError:
          error instanceof Error ? error.message : "Не удалось начать воспроизведение.",
        hostPlaybackStatus: "paused",
      }));
    }
  }, [attachHostPreview]);

  const hostPause = useCallback(() => {
    filePublicationRef.current?.videoElement.pause();
  }, []);

  const hostSeek = useCallback((seconds: number, onComplete?: () => void) => {
    hostSeekControllerRef.current?.seek(seconds, onComplete);
  }, []);

  const publishFile = useCallback(
    async (options: PublishFileOptions = {}) => {
      const file = state.fileResult;
      const connection = liveKitConnectionRef.current;
      const participant = participantRef.current;

      if (participant?.role !== "HOST") {
        setState((current) => ({
          ...current,
          filePublicationError: "Публиковать файл может только host.",
          filePublicationStatus: "error",
          filePublicationTrackCount: 0,
        }));
        return;
      }

      if (!file) {
        setState((current) => ({
          ...current,
          filePublicationError: "Сначала выберите видеофайл.",
          filePublicationStatus: "error",
          filePublicationTrackCount: 0,
        }));
        return;
      }

      if (!connection || state.liveKitStatus !== "connected") {
        setState((current) => ({
          ...current,
          filePublicationError: "LiveKit ещё не подключён.",
          filePublicationStatus: "error",
          filePublicationTrackCount: 0,
        }));
        return;
      }

      const requestId = filePublicationRequestIdRef.current + 1;
      hostPublicationRecoveryRequestedRef.current = false;
      hostPlaybackRecoveryCheckpointRef.current = null;
      filePublicationRequestIdRef.current = requestId;
      stopCurrentFilePublication();
      setState((current) => ({
        ...current,
        filePublicationError: null,
        filePublicationStatus: options.status ?? "publishing",
        filePublicationTrackCount: 0,
      }));

      try {
        const publication = await publishFileToLiveKit(connection.room, file, options.checkpoint);
        if (filePublicationRequestIdRef.current !== requestId) {
          stopLiveKitFilePublication(connection.room, publication);
          return;
        }

        filePublicationRef.current = publication;
        attachHostPreview(publication);
        playbackStatePublisherRef.current = createHostPlaybackStatePublisher(
          connection.room,
          publication.videoElement,
          file.displayName,
        );
        startHostPlaybackTracking(publication.videoElement);
        setState((current) => ({
          ...current,
          filePublicationError: null,
          filePublicationStatus: "live",
          filePublicationTrackCount: publication.tracks.length,
        }));
        telemetryTrackerRef.current?.onPublishStart();
        if (options.status === "restarting") {
          telemetryTrackerRef.current?.onRecoverySucceeded();
          if (options.recoveryRecipientIdentity) {
            void mediaRecoverySignalControllerRef.current
              ?.sendRecoveryStatus(
                options.recoveryRecipientIdentity,
                "succeeded",
                options.recoveryRequestId,
              )
              .catch(() => {});
          }
        }
      } catch (error) {
        if (filePublicationRequestIdRef.current !== requestId) {
          return;
        }

        const message =
          error instanceof FilePublicationFailure
            ? error.message
            : "Не удалось опубликовать файл в LiveKit.";
        filePublicationRef.current = null;
        setState((current) => ({
          ...current,
          filePublicationError: message,
          filePublicationStatus: "error",
          filePublicationTrackCount: 0,
        }));
        telemetryTrackerRef.current?.onPublishFailure(message);
        if (options.status === "restarting") {
          telemetryTrackerRef.current?.onRecoveryFailure(message);
          if (options.recoveryRecipientIdentity) {
            void mediaRecoverySignalControllerRef.current
              ?.sendRecoveryStatus(
                options.recoveryRecipientIdentity,
                "failed",
                options.recoveryRequestId,
              )
              .catch(() => {});
          }
        }
      }
    },
    [
      attachHostPreview,
      startHostPlaybackTracking,
      state.fileResult,
      state.liveKitStatus,
      stopCurrentFilePublication,
    ],
  );

  const restartFilePublication = useCallback(async () => {
    const publication = filePublicationRef.current;
    if (participantRef.current?.role !== "HOST" || !publication) {
      return;
    }

    const recoveryRecipientIdentity = state.mediaRecoveryAlert?.participantIdentity;
    const recoveryRequestId = state.mediaRecoveryAlert?.requestId;
    setState((current) => ({ ...current, mediaRecoveryAlert: null }));
    telemetryTrackerRef.current?.onRecoveryStarted();
    if (recoveryRecipientIdentity) {
      void mediaRecoverySignalControllerRef.current
        ?.sendRecoveryStatus(recoveryRecipientIdentity, "started", recoveryRequestId)
        .catch(() => {});
    }
    await publishFile({
      checkpoint: createHostPlaybackCheckpoint(publication.videoElement),
      recoveryRequestId,
      recoveryRecipientIdentity,
      status: "restarting",
    });
  }, [publishFile, state.mediaRecoveryAlert]);

  const disconnectLiveKit = useCallback(
    (nextStatus: LiveKitConnectionStatus = "idle") => {
      liveKitRequestIdRef.current += 1;
      filePublicationRequestIdRef.current += 1;
      stopCurrentFilePublication();
      voiceRequestIdRef.current += 1;
      stopCurrentVoicePublication();
      disconnectRemotePlayback();
      disconnectRemoteVoice();
      disconnectPlaybackStateReceiver();
      disconnectQualityIndicators();
      disconnectMediaRecoverySignals();
      const connection = liveKitConnectionRef.current;
      liveKitConnectionRef.current = null;

      if (connection) {
        connection.disconnect();
      }

      setState((current) => ({
        ...current,
        filePublicationError: null,
        filePublicationStatus: "idle",
        filePublicationTrackCount: 0,
        liveKitError: null,
        liveKitStatus: nextStatus,
        qualityIndicators: idleQualityIndicatorsState,
        userError: current.userError?.area === "livekit" ? null : current.userError,
        voiceError: null,
        voiceStatus: "idle",
      }));
    },
    [
      disconnectQualityIndicators,
      disconnectMediaRecoverySignals,
      disconnectPlaybackStateReceiver,
      disconnectRemotePlayback,
      disconnectRemoteVoice,
      stopCurrentFilePublication,
      stopCurrentVoicePublication,
    ],
  );

  const disconnectSocket = useCallback(
    (nextStatus: RoomConnectionStatus = "idle", options: { resetReconnect?: boolean } = {}) => {
      if (options.resetReconnect ?? true) {
        resetSocketReconnect();
      } else {
        clearSocketReconnectTimer();
      }

      const socket = socketRef.current;
      socketRef.current = null;
      stopHeartbeat();

      if (socket && socket.readyState !== socket.CLOSING && socket.readyState !== socket.CLOSED) {
        socket.close(1000, "client disconnected");
      }

      setState((current) => ({
        ...current,
        connectionStatus: nextStatus,
        userError: current.userError?.area === "websocket" ? null : current.userError,
      }));
    },
    [clearSocketReconnectTimer, resetSocketReconnect, stopHeartbeat],
  );

  const connectLiveKit = useCallback(
    async (room: RoomSnapshot) => {
      const requestId = liveKitRequestIdRef.current + 1;
      liveKitRequestIdRef.current = requestId;
      const existingConnection = liveKitConnectionRef.current;
      liveKitConnectionRef.current = null;
      stopCurrentFilePublication();
      voiceRequestIdRef.current += 1;
      stopCurrentVoicePublication();
      disconnectRemotePlayback();
      disconnectRemoteVoice();
      disconnectPlaybackStateReceiver();
      disconnectQualityIndicators();

      if (existingConnection) {
        existingConnection.disconnect();
      }

      setState((current) => ({
        ...current,
        liveKitError: null,
        liveKitStatus: "connecting",
        ...clearUserErrorFor(current, "livekit"),
      }));

      try {
        const token = await mintLiveKitToken(room.roomId);
        if (liveKitRequestIdRef.current !== requestId) {
          return;
        }

        const connection = await connectLiveKitRoom(token, {
          onError: (message) => {
            if (liveKitRequestIdRef.current !== requestId) {
              return;
            }

            setState((current) => ({
              ...current,
              liveKitError: message,
              liveKitStatus: "error",
              userError: createLiveKitMessageUserError(message),
            }));
          },
          onStatusChange: (status) => {
            if (liveKitRequestIdRef.current !== requestId) {
              return;
            }

            if (status === "disconnected") {
              hostPublicationRecoveryRequestedRef.current =
                participantRef.current?.role === "HOST" && filePublicationRef.current !== null;
              hostPlaybackRecoveryCheckpointRef.current = filePublicationRef.current
                ? createHostPlaybackCheckpoint(filePublicationRef.current.videoElement)
                : null;
              filePublicationRequestIdRef.current += 1;
              stopCurrentFilePublication();
              voiceRequestIdRef.current += 1;
              stopCurrentVoicePublication();
              disconnectRemotePlayback();
              disconnectRemoteVoice();
              disconnectPlaybackStateReceiver();
              disconnectQualityIndicators();
              disconnectMediaRecoverySignals();
              telemetryTrackerRef.current?.reset();
            }

            setState((current) => ({
              ...current,
              filePublicationError: status === "disconnected" ? null : current.filePublicationError,
              filePublicationStatus:
                status === "disconnected" ? "idle" : current.filePublicationStatus,
              filePublicationTrackCount:
                status === "disconnected" ? 0 : current.filePublicationTrackCount,
              liveKitError: status === "error" ? current.liveKitError : null,
              liveKitStatus: status,
              qualityIndicators:
                status === "disconnected" ? idleQualityIndicatorsState : current.qualityIndicators,
              userError:
                status === "connected" && current.userError?.area === "livekit"
                  ? null
                  : current.userError,
              voiceError: status === "disconnected" ? null : current.voiceError,
              voiceStatus: status === "disconnected" ? "idle" : current.voiceStatus,
            }));
          },
        });
        if (liveKitRequestIdRef.current !== requestId) {
          connection.disconnect();
          return;
        }

        liveKitConnectionRef.current = connection;
        qualityIndicatorControllerRef.current = createQualityIndicatorController(connection.room, {
          onStateChange: (qualityIndicators) => {
            if (liveKitRequestIdRef.current !== requestId) {
              return;
            }

            setState((current) => ({
              ...current,
              qualityIndicators,
            }));

            telemetryTrackerRef.current?.onQuality(qualityIndicators);
          },
        });
        const voiceController = createRemoteVoiceController(connection.room, {
          onStateChange: (remoteVoice) => {
            if (liveKitRequestIdRef.current !== requestId) {
              return;
            }

            setState((current) => ({
              ...current,
              voiceRemoteError: remoteVoice.error,
              voiceRemoteParticipantCount: remoteVoice.trackCount,
              voiceRemoteParticipantIdentities: remoteVoice.participantIdentities,
            }));
          },
        });
        remoteVoiceControllerRef.current = voiceController;
        mediaRecoverySignalControllerRef.current = createMediaRecoverySignalController(
          connection.room,
          {
            expectedHostIdentity: room.hostParticipantId ?? undefined,
            isHost: participantRef.current?.role === "HOST",
            onRecoveryRequested: (request) => {
              if (liveKitRequestIdRef.current !== requestId) {
                return;
              }

              setState((current) => ({ ...current, mediaRecoveryAlert: request }));
            },
            onRecoveryStatus: (update) => {
              if (liveKitRequestIdRef.current !== requestId) {
                return;
              }

              setState((current) => ({
                ...current,
                mediaRecoveryHostStatus: update.status,
                mediaRecoveryRequestStatus: "idle",
              }));
            },
          },
        );

        if (participantRef.current?.role === "GUEST") {
          const playbackController = createRemotePlaybackController(connection.room, {
            onStateChange: (remotePlayback) => {
              if (liveKitRequestIdRef.current !== requestId) {
                return;
              }

              setState((current) => ({
                ...current,
                remotePlaybackAudioTrackName: remotePlayback.audioTrackName,
                remotePlaybackError: remotePlayback.error,
                remotePlaybackParticipantIdentity: remotePlayback.participantIdentity,
                remotePlaybackStatus: remotePlayback.status,
                remotePlaybackTrackCount: remotePlayback.trackCount,
                remotePlaybackVideoTrackName: remotePlayback.videoTrackName,
              }));

              telemetryTrackerRef.current?.onRemotePlayback(remotePlayback);
            },
          });
          remotePlaybackControllerRef.current = playbackController;
          playbackController.setElements(remotePlaybackElementsRef.current);

          const playbackStateReceiver = createGuestPlaybackStateReceiver(
            connection.room,
            room.hostParticipantId,
            {
              onStateChange: (playbackState) => {
                if (liveKitRequestIdRef.current !== requestId) {
                  return;
                }

                setState((current) => ({
                  ...current,
                  playbackSyncCurrentTime: playbackState.currentTime,
                  playbackSyncDuration: playbackState.duration,
                  playbackSyncError: playbackState.error,
                  playbackSyncEvent: playbackState.event,
                  playbackSyncFileName: playbackState.fileName,
                  playbackSyncParticipantIdentity: playbackState.participantIdentity,
                  playbackSyncReceivedAt: playbackState.receivedAt,
                  playbackSyncRevision: playbackState.revision,
                  playbackSyncSentAt: playbackState.sentAt,
                  playbackSyncStatus: playbackState.status,
                }));
              },
            },
          );
          playbackStateReceiverRef.current = playbackStateReceiver;
          playbackStateReceiver.setVideoElement(remotePlaybackElementsRef.current.videoElement);
        }
      } catch (error) {
        if (liveKitRequestIdRef.current !== requestId) {
          return;
        }

        setState((current) => ({
          ...current,
          liveKitError: getErrorMessage(error),
          liveKitStatus: "error",
          userError: createLiveKitUserError(error),
        }));
      }
    },
    [
      disconnectQualityIndicators,
      disconnectMediaRecoverySignals,
      disconnectPlaybackStateReceiver,
      disconnectRemotePlayback,
      disconnectRemoteVoice,
      stopCurrentFilePublication,
      stopCurrentVoicePublication,
    ],
  );

  const sendHeartbeat = useCallback((socket: WebSocket) => {
    const participant = participantRef.current;
    const room = roomRef.current;

    if (!participant || !room || socket.readyState !== socket.OPEN) {
      return;
    }

    const occurredAt = new Date().toISOString();
    socket.send(
      JSON.stringify({
        schemaVersion: 1,
        eventId: createEventId(),
        type: "participant.heartbeat",
        roomId: room.roomId,
        participantId: participant.participantId,
        expectedRoomVersion: room.roomVersion,
        occurredAt,
        payload: {
          sentAt: occurredAt,
        },
      }),
    );
  }, []);

  const sendChatMessage = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return false;
    }
    if (trimmed.length > MAX_CHAT_MESSAGE_LENGTH) {
      setState((current) => ({
        ...current,
        chatError: `Сообщение длиннее ${MAX_CHAT_MESSAGE_LENGTH} символов.`,
      }));
      return false;
    }

    const participant = participantRef.current;
    const room = roomRef.current;
    const socket = socketRef.current;
    if (!participant || !room || !socket || socket.readyState !== socket.OPEN) {
      setState((current) => ({ ...current, chatError: "Нет соединения с комнатой." }));
      return false;
    }

    const occurredAt = new Date().toISOString();
    socket.send(
      JSON.stringify({
        schemaVersion: 1,
        eventId: createEventId(),
        type: "chat.message",
        roomId: room.roomId,
        participantId: participant.participantId,
        expectedRoomVersion: room.roomVersion,
        occurredAt,
        payload: {
          clientMessageId: createEventId(),
          text: trimmed,
        },
      }),
    );
    setState((current) => (current.chatError ? { ...current, chatError: null } : current));
    return true;
  }, []);

  const startVoiceChat = useCallback(async () => {
    const connection = liveKitConnectionRef.current;
    if (!connection || state.liveKitStatus !== "connected") {
      setState((current) => ({
        ...current,
        voiceError: "LiveKit ещё не подключён.",
        voiceStatus: "error",
      }));
      return;
    }

    if (voicePublicationRef.current || state.voiceStatus === "requesting") {
      return;
    }

    const requestId = voiceRequestIdRef.current + 1;
    voiceRequestIdRef.current = requestId;
    setState((current) => ({
      ...current,
      voiceError: null,
      voiceStatus: "requesting",
    }));

    try {
      const publication = await publishVoiceToLiveKit(connection.room);
      if (voiceRequestIdRef.current !== requestId) {
        stopLiveKitVoicePublication(connection.room, publication);
        return;
      }

      voicePublicationRef.current = publication;
      setState((current) => ({
        ...current,
        voiceError: null,
        voiceStatus: "live",
      }));
    } catch (error) {
      if (voiceRequestIdRef.current !== requestId) {
        return;
      }

      setState((current) => ({
        ...current,
        voiceError:
          error instanceof VoiceChatFailure ? error.message : "Не удалось включить голосовой чат.",
        voiceStatus: "error",
      }));
    }
  }, [state.liveKitStatus, state.voiceStatus]);

  const muteVoiceChat = useCallback(async () => {
    const publication = voicePublicationRef.current;
    if (!publication) {
      return;
    }

    try {
      await muteVoicePublication(publication);
      setState((current) => ({
        ...current,
        voiceError: null,
        voiceStatus: "muted",
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        voiceError:
          error instanceof VoiceChatFailure ? error.message : "Не удалось выключить микрофон.",
        voiceStatus: "error",
      }));
    }
  }, []);

  const unmuteVoiceChat = useCallback(async () => {
    const publication = voicePublicationRef.current;
    if (!publication) {
      return;
    }

    try {
      await unmuteVoicePublication(publication);
      setState((current) => ({
        ...current,
        voiceError: null,
        voiceStatus: "live",
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        voiceError:
          error instanceof VoiceChatFailure ? error.message : "Не удалось включить микрофон.",
        voiceStatus: "error",
      }));
    }
  }, []);

  const stopVoiceChat = useCallback(() => {
    voiceRequestIdRef.current += 1;
    stopCurrentVoicePublication();
    setState((current) => ({
      ...current,
      voiceError: null,
      voiceStatus: "idle",
    }));
  }, [stopCurrentVoicePublication]);

  const scheduleRoomReconnect = useCallback(() => {
    clearSocketReconnectTimer();

    const room = roomRef.current;
    const participant = participantRef.current;
    if (!room || !participant || isTerminalRoomStatus(room.status)) {
      setState((current) => ({
        ...current,
        connectionStatus: current.room ? "closed" : "idle",
      }));
      return;
    }

    const attempt = socketReconnectAttemptRef.current;
    if (attempt >= MAX_ROOM_RECONNECT_ATTEMPTS) {
      const userError = createWebSocketUserError(
        "Не удалось восстановить WebSocket комнаты. Проверьте сеть или попробуйте переподключиться вручную.",
        true,
      );
      setState((current) => ({
        ...current,
        connectionStatus: "error",
        error: userError.message,
        userError,
      }));
      return;
    }

    const delay = ROOM_RECONNECT_DELAYS_MS[Math.min(attempt, ROOM_RECONNECT_DELAYS_MS.length - 1)];
    socketReconnectAttemptRef.current = attempt + 1;
    socketReconnectTimerRef.current = window.setTimeout(() => {
      socketReconnectTimerRef.current = null;

      const latestRoom = roomRef.current;
      const latestParticipant = participantRef.current;
      if (!latestRoom || !latestParticipant || isTerminalRoomStatus(latestRoom.status)) {
        setState((current) => ({
          ...current,
          connectionStatus: current.room ? "closed" : "idle",
        }));
        return;
      }

      connectRoomEventsRef.current?.(latestRoom, latestParticipant, {
        preserveChat: true,
        reconnect: true,
      });
    }, delay);

    setState((current) => ({
      ...current,
      connectionStatus: "reconnecting",
      error: null,
      events:
        attempt === 0
          ? addLocalEvent(current.events, "Соединение потеряно, переподключаемся")
          : current.events,
      ...clearUserErrorFor(current, "websocket"),
    }));
  }, [clearSocketReconnectTimer]);

  const connectRoomEvents = useCallback(
    (room: RoomSnapshot, participant: Participant, options: ConnectRoomEventsOptions = {}) => {
      const reconnect = options.reconnect ?? false;
      disconnectSocket(reconnect ? "reconnecting" : "connecting", {
        resetReconnect: !reconnect,
      });

      if (!("WebSocket" in window)) {
        const userError = createWebSocketUserError(
          "Браузер не поддерживает WebSocket. Откройте комнату в актуальном Chrome, Edge, Firefox или Safari.",
          false,
        );
        setState((current) => ({
          ...current,
          connectionStatus: "error",
          error: userError.message,
          userError,
        }));
        return;
      }

      participantRef.current = participant;
      roomRef.current = room;

      setState((current) => ({
        ...current,
        chatError: null,
        chatMessages: options.preserveChat ? current.chatMessages : [],
      }));

      const socket = new WebSocket(resolveRoomEventsUrl(room.roomId));
      socketRef.current = socket;

      socket.onopen = () => {
        if (socketRef.current !== socket) {
          return;
        }

        resetSocketReconnect();
        setState((current) => ({
          ...current,
          connectionStatus: "open",
          error: null,
          events: reconnect
            ? addLocalEvent(current.events, "Соединение с комнатой восстановлено")
            : current.events,
          ...clearUserErrorFor(current, "websocket"),
        }));
        sendHeartbeat(socket);
        heartbeatTimerRef.current = window.setInterval(
          () => sendHeartbeat(socket),
          HEARTBEAT_INTERVAL_MS,
        );
      };

      socket.onmessage = (message) => {
        if (typeof message.data !== "string") {
          return;
        }

        try {
          const event = parseRoomServerEvent(JSON.parse(message.data));
          setState((current) => applyEventToState(current, event));
          if (event.type === "room.closed") {
            clearFileState();
            disconnectLiveKit("disconnected");
          }
        } catch {
          const userError = createWebSocketUserError(
            "Сервер прислал событие комнаты в неожиданном формате. Переподключение запросит свежий snapshot комнаты.",
            true,
          );
          setState((current) => ({
            ...current,
            error: userError.message,
            userError,
          }));
        }
      };

      socket.onerror = () => {
        if (socketRef.current !== socket) {
          return;
        }

        setState((current) => ({
          ...current,
          connectionStatus: reconnect || current.room ? "reconnecting" : "error",
          error: reconnect || current.room ? null : "WebSocket комнаты недоступен.",
          userError:
            reconnect || current.room
              ? current.userError
              : createWebSocketUserError("WebSocket комнаты недоступен.", true),
        }));
      };

      socket.onclose = (event) => {
        if (socketRef.current !== socket) {
          return;
        }

        socketRef.current = null;
        stopHeartbeat();

        const currentRoom = roomRef.current;
        const intentionalClose =
          event.code === NORMAL_WS_CLOSE_CODE ||
          pendingActionRef.current === "close" ||
          pendingActionRef.current === "leave" ||
          (currentRoom !== null && isTerminalRoomStatus(currentRoom.status));

        if (!intentionalClose) {
          scheduleRoomReconnect();
          return;
        }

        setState((current) => ({
          ...current,
          connectionStatus: "closed",
          events:
            current.pendingAction === "close"
              ? addLocalEvent(current.events, "Комната закрыта")
              : current.events,
          pendingAction:
            current.pendingAction === "close" || current.pendingAction === "leave"
              ? null
              : current.pendingAction,
          room:
            current.pendingAction === "close" && current.room
              ? markRoomClosed(current.room)
              : current.room,
        }));
      };
    },
    [
      clearFileState,
      disconnectLiveKit,
      disconnectSocket,
      resetSocketReconnect,
      scheduleRoomReconnect,
      sendHeartbeat,
      stopHeartbeat,
    ],
  );

  useEffect(() => {
    connectRoomEventsRef.current = connectRoomEvents;
  }, [connectRoomEvents]);

  useEffect(() => {
    const handleOffline = () => {
      const room = roomRef.current;
      const participant = participantRef.current;
      if (!room || !participant || !socketRef.current || isTerminalRoomStatus(room.status)) {
        return;
      }

      disconnectSocket("reconnecting", { resetReconnect: false });
      scheduleRoomReconnect();
    };

    window.addEventListener("offline", handleOffline);
    return () => window.removeEventListener("offline", handleOffline);
  }, [disconnectSocket, scheduleRoomReconnect]);

  const create = useCallback(
    async (hostDisplayName: string) => {
      const displayName = hostDisplayName.trim();
      if (!displayName) {
        setState((current) => ({
          ...current,
          error: "Укажите имя host.",
          userError: {
            action: null,
            area: "room",
            message: "Укажите имя host.",
            retryable: false,
            title: "Проверьте форму",
          },
        }));
        return;
      }

      lastRoomActionRef.current = { type: "create", hostDisplayName };
      setState((current) => ({
        ...current,
        error: null,
        pendingAction: "create",
        userError: null,
      }));

      try {
        const result = await createRoom(displayName);
        const participant = findCurrentParticipant(result.room);
        saveHostSecret(result.room.roomId, result.hostSecret);
        setState((current) => ({
          ...current,
          error: null,
          events: addLocalEvent(current.events, "Комната создана"),
          hostSecret: result.hostSecret,
          invitePath: result.invitePath,
          participant,
          pendingAction: null,
          room: result.room,
          userError: null,
        }));
        connectRoomEvents(result.room, participant);
        void connectLiveKit(result.room);
      } catch (error) {
        const userError = createRoomActionUserError(error);
        setState((current) => ({
          ...current,
          error: userError.message,
          pendingAction: null,
          userError,
        }));
      }
    },
    [connectLiveKit, connectRoomEvents],
  );

  const restore = useCallback(
    async (roomId: string, signal?: AbortSignal) => {
      const normalizedRoomId = extractRoomId(roomId);
      if (!roomIdSchema.safeParse(normalizedRoomId).success) {
        setState((current) => ({
          ...current,
          error: "Проверьте ID комнаты.",
          userError: {
            action: null,
            area: "room",
            message: "Проверьте ID комнаты.",
            retryable: false,
            title: "Проверьте форму",
          },
        }));
        return;
      }

      lastRoomActionRef.current = { type: "restore", roomId: normalizedRoomId };
      setState((current) => ({
        ...current,
        error: null,
        pendingAction: "restore",
        userError: null,
      }));

      try {
        const result = await getRoom(normalizedRoomId, signal);
        if (signal?.aborted) {
          return;
        }

        const hostSecret =
          result.participant.role === "HOST" ? readHostSecret(result.room.roomId) : null;
        setState((current) => ({
          ...current,
          error: null,
          events: addLocalEvent(current.events, "Комната восстановлена"),
          hostSecret,
          invitePath: `/rooms/${result.room.roomId}`,
          participant: result.participant,
          pendingAction: null,
          room: result.room,
          userError: null,
        }));
        connectRoomEvents(result.room, result.participant);
        void connectLiveKit(result.room);
      } catch (error) {
        if (signal?.aborted) {
          return;
        }

        const userError = createRoomActionUserError(error);
        setState((current) => ({
          ...current,
          error: userError.message,
          pendingAction: null,
          userError,
        }));
      }
    },
    [connectLiveKit, connectRoomEvents],
  );

  const join = useCallback(
    async (roomId: string, displayNameValue: string) => {
      const normalizedRoomId = extractRoomId(roomId);
      const displayName = displayNameValue.trim();

      if (!roomIdSchema.safeParse(normalizedRoomId).success) {
        setState((current) => ({
          ...current,
          error: "Проверьте ID комнаты.",
          userError: {
            action: null,
            area: "room",
            message: "Проверьте ID комнаты.",
            retryable: false,
            title: "Проверьте форму",
          },
        }));
        return;
      }

      if (!displayName) {
        setState((current) => ({
          ...current,
          error: "Укажите имя участника.",
          userError: {
            action: null,
            area: "room",
            message: "Укажите имя участника.",
            retryable: false,
            title: "Проверьте форму",
          },
        }));
        return;
      }

      lastRoomActionRef.current = { type: "join", displayName, roomId: normalizedRoomId };
      setState((current) => ({
        ...current,
        error: null,
        pendingAction: "join",
        userError: null,
      }));

      try {
        const result = await joinRoom(normalizedRoomId, displayName);
        setState((current) => ({
          ...current,
          error: null,
          events: addLocalEvent(current.events, "Вы вошли в комнату"),
          hostSecret: null,
          invitePath: `/rooms/${result.room.roomId}`,
          participant: result.participant,
          pendingAction: null,
          room: result.room,
          userError: null,
        }));
        connectRoomEvents(result.room, result.participant);
        void connectLiveKit(result.room);
      } catch (error) {
        const userError = createRoomActionUserError(error);
        setState((current) => ({
          ...current,
          error: userError.message,
          pendingAction: null,
          userError,
        }));
      }
    },
    [connectLiveKit, connectRoomEvents],
  );

  const leave = useCallback(async () => {
    const room = roomRef.current;
    if (!room) {
      return;
    }

    lastRoomActionRef.current = { type: "leave" };
    setState((current) => ({
      ...current,
      error: null,
      pendingAction: "leave",
      userError: null,
    }));

    try {
      await leaveRoom(room.roomId);
      clearFileState();
      disconnectLiveKit("idle");
      disconnectSocket("idle");
      setState((current) => ({
        ...initialState,
        events: addLocalEvent(current.events, "Вы покинули комнату"),
      }));
    } catch (error) {
      const userError = createRoomActionUserError(error);
      setState((current) => ({
        ...current,
        error: userError.message,
        pendingAction: null,
        userError,
      }));
    }
  }, [clearFileState, disconnectLiveKit, disconnectSocket]);

  const close = useCallback(async () => {
    const room = roomRef.current;
    if (!room || !state.hostSecret) {
      setState((current) => ({
        ...current,
        error: "Закрыть комнату может только host.",
        userError: {
          action: null,
          area: "room",
          message: "Закрыть комнату может только host.",
          retryable: false,
          title: "Нет доступа к комнате",
        },
      }));
      return;
    }

    lastRoomActionRef.current = { type: "close" };
    pendingActionRef.current = "close";
    setState((current) => ({
      ...current,
      error: null,
      pendingAction: "close",
      userError: null,
    }));

    try {
      await closeRoom(room.roomId, state.hostSecret);
      removeHostSecret(room.roomId);
      clearFileState();
      disconnectLiveKit("disconnected");
      setState((current) => ({
        ...current,
        events: addLocalEvent(current.events, "Комната закрывается"),
      }));
    } catch (error) {
      pendingActionRef.current = null;
      const userError = createRoomActionUserError(error);
      setState((current) => ({
        ...current,
        error: userError.message,
        pendingAction: null,
        userError,
      }));
    }
  }, [clearFileState, disconnectLiveKit, state.hostSecret]);

  const retryLastRoomAction = useCallback(() => {
    const action = lastRoomActionRef.current;
    if (!action) {
      return;
    }

    switch (action.type) {
      case "create":
        void create(action.hostDisplayName);
        break;
      case "join":
        void join(action.roomId, action.displayName);
        break;
      case "restore":
        void restore(action.roomId);
        break;
      case "leave":
        void leave();
        break;
      case "close":
        void close();
        break;
    }
  }, [close, create, join, leave, restore]);

  const retryLiveKitConnection = useCallback(() => {
    const room = roomRef.current;
    if (!room || isTerminalRoomStatus(room.status)) {
      setState((current) => ({
        ...current,
        liveKitError: "Комната закрыта, LiveKit больше не подключается.",
        liveKitStatus: "error",
        userError: createLiveKitMessageUserError(
          "Комната закрыта, LiveKit больше не подключается.",
        ),
      }));
      return;
    }

    void connectLiveKit(room);
  }, [connectLiveKit]);

  const retryRoomConnection = useCallback(() => {
    const room = roomRef.current;
    const participant = participantRef.current;
    if (!room || !participant || isTerminalRoomStatus(room.status)) {
      const userError = createWebSocketUserError(
        "Комната уже закрыта или не восстановлена в текущей вкладке.",
        false,
      );
      setState((current) => ({
        ...current,
        connectionStatus: current.room ? "closed" : "idle",
        error: userError.message,
        userError,
      }));
      return;
    }

    resetSocketReconnect();
    setState((current) => ({
      ...current,
      error: null,
      userError: current.userError?.area === "websocket" ? null : current.userError,
    }));
    connectRoomEventsRef.current?.(room, participant, {
      preserveChat: true,
      reconnect: true,
    });
  }, [resetSocketReconnect]);

  const clearUserError = useCallback(() => {
    setState((current) => ({
      ...current,
      error: current.userError?.message === current.error ? null : current.error,
      userError: null,
    }));
  }, []);

  useEffect(() => {
    if (
      !routeRoomId ||
      roomRef.current?.roomId === routeRoomId ||
      restoredRouteRoomIdRef.current === routeRoomId
    ) {
      return undefined;
    }

    const controller = new AbortController();
    restoredRouteRoomIdRef.current = routeRoomId;
    void restore(routeRoomId, controller.signal);
    return () => controller.abort();
  }, [restore, routeRoomId]);

  useEffect(
    () => () => {
      clearFileState();
      disconnectLiveKit("idle");
      disconnectSocket("idle");
    },
    [clearFileState, disconnectLiveKit, disconnectSocket],
  );

  useEffect(() => {
    if (state.mediaRecoveryRequestStatus !== "sent") {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setState((current) =>
        current.mediaRecoveryRequestStatus === "sent" && current.mediaRecoveryHostStatus === "idle"
          ? { ...current, mediaRecoveryRequestStatus: "unanswered" }
          : current,
      );
    }, 10_000);

    return () => window.clearTimeout(timer);
  }, [state.mediaRecoveryRequestStatus]);

  useEffect(() => {
    if (state.mediaRecoveryHostStatus === "idle") {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setState((current) =>
        current.mediaRecoveryHostStatus === state.mediaRecoveryHostStatus
          ? { ...current, mediaRecoveryHostStatus: "idle" }
          : current,
      );
    }, 10_000);

    return () => window.clearTimeout(timer);
  }, [state.mediaRecoveryHostStatus]);

  useEffect(() => {
    if (!hostPublicationRecoveryRequestedRef.current) {
      return;
    }

    if (state.participant?.role !== "HOST") {
      hostPublicationRecoveryRequestedRef.current = false;
      return;
    }

    if (state.liveKitStatus !== "connected") {
      return;
    }

    if (
      state.filePublicationStatus === "live" ||
      state.filePublicationStatus === "publishing" ||
      state.filePublicationStatus === "restarting"
    ) {
      hostPublicationRecoveryRequestedRef.current = false;
      return;
    }

    if (!state.fileResult) {
      hostPublicationRecoveryRequestedRef.current = false;
      setState((current) => ({
        ...current,
        filePublicationError:
          "После переподключения выберите файл заново, чтобы возобновить показ.",
        filePublicationStatus: "error",
        filePublicationTrackCount: 0,
      }));
      return;
    }

    const checkpoint = hostPlaybackRecoveryCheckpointRef.current ?? undefined;
    hostPublicationRecoveryRequestedRef.current = false;
    hostPlaybackRecoveryCheckpointRef.current = null;
    void publishFile({ checkpoint });
  }, [
    publishFile,
    state.filePublicationStatus,
    state.fileResult,
    state.liveKitStatus,
    state.participant?.role,
  ]);

  const inviteUrl = useMemo(() => {
    const path = state.invitePath ?? (state.room ? `/rooms/${state.room.roomId}` : null);
    return path ? new URL(path, window.location.origin).toString() : null;
  }, [state.invitePath, state.room]);

  return {
    ...state,
    close,
    create,
    clearUserError,
    hostPause,
    hostPlay,
    hostSeek,
    restartFilePublication,
    requestMediaRecovery,
    inviteUrl,
    join,
    leave,
    muteVoiceChat,
    publishFile,
    retryLastRoomAction,
    retryLiveKitConnection,
    retryRoomConnection,
    resumeRemotePlaybackAudio,
    restore,
    routeRoomId,
    selectFile,
    sendChatMessage,
    setHostPreviewElement,
    setRemotePlaybackElements,
    stopFilePublication,
    stopVoiceChat,
    startVoiceChat,
    unmuteVoiceChat,
  };
}

function applyEventToState(current: RoomSessionState, event: RoomServerEvent): RoomSessionState {
  if (!isKnownRoomServerEvent(event)) {
    if (event.type === "error") {
      const problem = extractProblem(event.payload);
      const message = problem.detail ?? problem.title ?? "Действие отклонено сервером.";
      if (problem.code === "RATE_LIMITED" || problem.code === "VALIDATION_FAILED") {
        return { ...current, chatError: message };
      }
      return {
        ...current,
        error: message,
        userError: createServerEventUserError(event.payload),
      };
    }

    return {
      ...current,
      error: null,
      events: addServerEvent(current.events, event),
    };
  }

  if (event.type === "chat.message") {
    return {
      ...current,
      error: null,
      chatError: null,
      chatMessages: appendChatMessage(current.chatMessages, {
        id: event.payload.messageId,
        kind: "user",
        participantId: event.payload.participantId,
        displayName: event.payload.displayName,
        text: event.payload.text,
        sentAt: event.payload.sentAt,
      }),
    };
  }

  const nextRoom = applyRoomServerEvent(current.room, event);
  const nextParticipant = syncParticipant(current.participant, nextRoom);
  const systemText = systemChatText(event, current.room);
  const nextChatMessages = systemText
    ? appendChatMessage(current.chatMessages, {
        id: event.eventId,
        kind: "system",
        participantId: null,
        displayName: null,
        text: systemText,
        sentAt: event.occurredAt,
      })
    : current.chatMessages;

  let nextHostReconnectDeadline = current.hostReconnectDeadline;
  if (event.type === "host.disconnected") {
    nextHostReconnectDeadline = event.payload.reconnectDeadline;
  } else if (nextRoom?.status !== "HOST_DISCONNECTED") {
    nextHostReconnectDeadline = null;
  }

  return {
    ...current,
    chatMessages: nextChatMessages,
    connectionStatus: event.type === "room.closed" ? "closed" : current.connectionStatus,
    error: null,
    events: addServerEvent(current.events, event),
    hostReconnectDeadline: nextHostReconnectDeadline,
    participant: nextParticipant,
    pendingAction: event.type === "room.closed" ? null : current.pendingAction,
    room: nextRoom,
    userError: event.type === "room.closed" ? null : current.userError,
  };
}

function systemChatText(event: KnownRoomServerEvent, room: RoomSnapshot | null): string | null {
  switch (event.type) {
    case "participant.joined":
      return `${event.payload.displayName} присоединился к комнате`;
    case "participant.left": {
      const name = room?.participants.find(
        (participant) => participant.participantId === event.payload.participantId,
      )?.displayName;
      return `${name ?? "Участник"} покинул комнату`;
    }
    case "room.closed":
      switch (event.payload.reason) {
        case "EXPIRED":
          return "Комната истекла";
        case "HOST_TIMEOUT":
          return "Host не вернулся, комната закрыта";
        default:
          return "Комната закрыта";
      }
    case "host.disconnected":
      return "Host отключился, ждём переподключения";
    case "host.reconnected":
      return "Host снова в сети";
    default:
      return null;
  }
}

function appendChatMessage(messages: ChatMessageEntry[], entry: ChatMessageEntry) {
  return [...messages, entry].slice(-MAX_CHAT_MESSAGES);
}

function extractProblem(payload: unknown): {
  code?: string;
  correlationId?: string;
  detail?: string;
  instance?: string;
  retryable?: boolean;
  status?: number;
  title?: string;
} {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const record = payload as Record<string, unknown>;
  return {
    code: typeof record.code === "string" ? record.code : undefined,
    correlationId: typeof record.correlationId === "string" ? record.correlationId : undefined,
    detail: typeof record.detail === "string" ? record.detail : undefined,
    instance: typeof record.instance === "string" ? record.instance : undefined,
    retryable: typeof record.retryable === "boolean" ? record.retryable : undefined,
    status: typeof record.status === "number" ? record.status : undefined,
    title: typeof record.title === "string" ? record.title : undefined,
  };
}

function addServerEvent(events: RoomEventLogEntry[], event: RoomServerEvent) {
  return [
    {
      eventId: event.eventId,
      label: describeRoomServerEvent(event),
      occurredAt: event.occurredAt,
      type: event.type,
    },
    ...events,
  ].slice(0, MAX_EVENT_LOG_ITEMS);
}

function addLocalEvent(events: RoomEventLogEntry[], label: string) {
  const occurredAt = new Date().toISOString();
  return [
    {
      eventId: createEventId(),
      label,
      occurredAt,
      type: "client.local",
    },
    ...events,
  ].slice(0, MAX_EVENT_LOG_ITEMS);
}

function findCurrentParticipant(room: RoomSnapshot) {
  return (
    room.participants.find((participant) => participant.participantId === room.hostParticipantId) ??
    room.participants[0]
  );
}

function syncParticipant(participant: Participant | null, room: RoomSnapshot | null) {
  if (!participant || !room) {
    return participant;
  }

  return (
    room.participants.find((item) => item.participantId === participant.participantId) ??
    participant
  );
}

function extractRoomId(value: string) {
  const trimmed = value.trim();
  const routeMatch = /\/rooms\/([A-Za-z0-9_-]{22})(?:[/?#]|$)/.exec(trimmed);
  if (routeMatch?.[1]) {
    return routeMatch[1];
  }

  return trimmed;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Не удалось выполнить действие.";
}

function createRoomActionUserError(error: unknown): RoomUserError {
  if (error instanceof ApiProblemError) {
    return {
      action: error.problem.retryable ? "retry-room-action" : null,
      area: "room",
      code: error.problem.code,
      correlationId: error.problem.correlationId,
      instance: error.problem.instance,
      message: getProblemMessage(error.problem.detail, error.problem.title, error.message),
      retryable: error.problem.retryable ?? false,
      status: error.problem.status,
      title: getRoomActionErrorTitle(error.problem.status, error.problem.title),
    };
  }

  return {
    action: "retry-room-action",
    area: "room",
    message: getErrorMessage(error),
    retryable: true,
    title: "Действие не выполнено",
  };
}

function createWebSocketUserError(message: string, retryable: boolean): RoomUserError {
  return {
    action: retryable ? "retry-websocket" : null,
    area: "websocket",
    code: retryable ? "ROOM_WS_RECONNECT_FAILED" : "ROOM_WS_UNAVAILABLE",
    message,
    retryable,
    title: retryable ? "Связь с комнатой не восстановилась" : "WebSocket недоступен",
  };
}

function createLiveKitUserError(error: unknown): RoomUserError {
  if (error instanceof ApiProblemError) {
    return {
      action: error.problem.retryable ? "retry-livekit" : null,
      area: "livekit",
      code: error.problem.code,
      correlationId: error.problem.correlationId,
      instance: error.problem.instance,
      message: getProblemMessage(error.problem.detail, error.problem.title, error.message),
      retryable: error.problem.retryable ?? false,
      status: error.problem.status,
      title: "LiveKit не подключён",
    };
  }

  return {
    action: "retry-livekit",
    area: "livekit",
    message: getErrorMessage(error),
    retryable: true,
    title: "LiveKit не подключён",
  };
}

function createLiveKitMessageUserError(message: string): RoomUserError {
  return {
    action: "retry-livekit",
    area: "livekit",
    message,
    retryable: true,
    title: "LiveKit не подключён",
  };
}

function createServerEventUserError(payload: unknown): RoomUserError {
  const problem = extractProblem(payload);
  return {
    action: problem.retryable ? "retry-room-action" : null,
    area: "room",
    code: problem.code,
    correlationId: problem.correlationId,
    instance: problem.instance,
    message: getProblemMessage(problem.detail, problem.title, "Действие отклонено сервером."),
    retryable: problem.retryable ?? false,
    status: problem.status,
    title: getRoomActionErrorTitle(problem.status, problem.title),
  };
}

function clearUserErrorFor(
  current: RoomSessionState,
  area: RoomUserErrorArea,
): Pick<RoomSessionState, "userError"> {
  return {
    userError: current.userError?.area === area ? null : current.userError,
  };
}

function getProblemMessage(
  detail?: string,
  title?: string,
  fallback = "Не удалось выполнить действие.",
) {
  return detail ?? title ?? fallback;
}

function getRoomActionErrorTitle(status?: number, title?: string) {
  if (status === 401 || status === 403) {
    return "Нет доступа к комнате";
  }

  if (status === 404) {
    return "Комната недоступна";
  }

  if (status === 409 || status === 410) {
    return "Комната уже изменилась";
  }

  if (status === 429) {
    return "Слишком много действий";
  }

  return title ?? "Действие не выполнено";
}

function isBenignPlayInterruption(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === "AbortError" ||
    error.message.includes("interrupted by a call to pause") ||
    error.message.includes("interrupted by a new load request")
  );
}

function isTerminalRoomStatus(status: RoomSnapshot["status"]) {
  return status === "CLOSED" || status === "EXPIRED";
}

function markRoomClosed(room: RoomSnapshot): RoomSnapshot {
  const updatedAt = new Date().toISOString();

  return {
    ...room,
    status: "CLOSED",
    participants: room.participants.map((participant) => ({
      ...participant,
      online: false,
    })),
    updatedAt,
  };
}

function hostSecretStorageKey(roomId: string) {
  return `${HOST_SECRET_STORAGE_PREFIX}${roomId}`;
}

function saveHostSecret(roomId: string, hostSecret: string) {
  try {
    window.sessionStorage.setItem(hostSecretStorageKey(roomId), hostSecret);
  } catch {
    // Host can still close the room until the current in-memory state is lost.
  }
}

function readHostSecret(roomId: string) {
  try {
    return window.sessionStorage.getItem(hostSecretStorageKey(roomId));
  } catch {
    return null;
  }
}

function removeHostSecret(roomId: string) {
  try {
    window.sessionStorage.removeItem(hostSecretStorageKey(roomId));
  } catch {
    // Nothing to clean up when browser storage is unavailable.
  }
}

function createEventId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (char) =>
    (Number(char) ^ (Math.floor(Math.random() * 16) >> (Number(char) / 4))).toString(16),
  );
}
