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

const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_EVENT_LOG_ITEMS = 8;
const MAX_CHAT_MESSAGES = 200;
const MAX_CHAT_MESSAGE_LENGTH = 1000;
const HOST_SECRET_STORAGE_PREFIX = "watch-together.host-secret.";
const MAX_ROOM_RECONNECT_ATTEMPTS = 10;
const ROOM_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 15_000] as const;

export type RoomConnectionStatus =
  "idle" | "connecting" | "open" | "reconnecting" | "closed" | "error";
export type RoomActionStatus = "create" | "join" | "restore" | "leave" | "close" | null;
export type FileStatus = "idle" | "checking" | "ready" | "error";
export type FilePublicationStatus = "idle" | "publishing" | "live" | "error";
export type HostPlaybackStatus = "idle" | "playing" | "paused" | "ended";

export type {
  FileDiagnosticsResult,
  PlaybackStatus,
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
  remotePlaybackAudioTrackName: string | null;
  remotePlaybackError: string | null;
  remotePlaybackParticipantIdentity: string | null;
  remotePlaybackStatus: RemotePlaybackStatus;
  remotePlaybackTrackCount: number;
  remotePlaybackVideoTrackName: string | null;
  room: RoomSnapshot | null;
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
  remotePlaybackAudioTrackName: null,
  remotePlaybackError: null,
  remotePlaybackParticipantIdentity: null,
  remotePlaybackStatus: "idle",
  remotePlaybackTrackCount: 0,
  remotePlaybackVideoTrackName: null,
  room: null,
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
  const hostPublicationRecoveryRequestedRef = useRef(false);
  const filePublicationRef = useRef<FilePublication | null>(null);
  const filePublicationRequestIdRef = useRef(0);
  const heartbeatTimerRef = useRef<number | null>(null);
  const liveKitConnectionRef = useRef<LiveKitConnection | null>(null);
  const liveKitRequestIdRef = useRef(0);
  const participantRef = useRef<Participant | null>(null);
  const pendingActionRef = useRef<RoomActionStatus>(null);
  const playbackStatePublisherRef = useRef<HostPlaybackStatePublisher | null>(null);
  const playbackStateReceiverRef = useRef<GuestPlaybackStateReceiver | null>(null);
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

  const setRemotePlaybackElements = useCallback((elements: RemotePlaybackElements) => {
    remotePlaybackElementsRef.current = elements;
    remotePlaybackControllerRef.current?.setElements(elements);
    playbackStateReceiverRef.current?.setVideoElement(elements.videoElement);
  }, []);

  const stopHostPlaybackTracking = useCallback(() => {
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
    stopPlaybackStatePublisher();
    stopHostPlaybackTracking();

    if (publication) {
      stopLiveKitFilePublication(liveKitConnectionRef.current?.room ?? null, publication);
    }
  }, [stopHostPlaybackTracking, stopPlaybackStatePublisher]);

  const stopFilePublication = useCallback(() => {
    hostPublicationRecoveryRequestedRef.current = false;
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

    hostPlaybackCleanupRef.current = () => {
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
    } catch (error) {
      setState((current) => ({
        ...current,
        hostPlaybackError:
          error instanceof Error ? error.message : "Не удалось начать воспроизведение.",
        hostPlaybackStatus: "paused",
      }));
    }
  }, []);

  const hostPause = useCallback(() => {
    filePublicationRef.current?.videoElement.pause();
  }, []);

  const hostSeek = useCallback((seconds: number) => {
    const publication = filePublicationRef.current;
    if (!publication || !Number.isFinite(seconds)) {
      return;
    }

    publication.videoElement.currentTime = Math.max(0, seconds);
  }, []);

  const publishFile = useCallback(async () => {
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
    filePublicationRequestIdRef.current = requestId;
    stopCurrentFilePublication();
    setState((current) => ({
      ...current,
      filePublicationError: null,
      filePublicationStatus: "publishing",
      filePublicationTrackCount: 0,
    }));

    try {
      const publication = await publishFileToLiveKit(connection.room, file);
      if (filePublicationRequestIdRef.current !== requestId) {
        stopLiveKitFilePublication(connection.room, publication);
        return;
      }

      filePublicationRef.current = publication;
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
    }
  }, [
    startHostPlaybackTracking,
    state.fileResult,
    state.liveKitStatus,
    stopCurrentFilePublication,
  ]);

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
        voiceError: null,
        voiceStatus: "idle",
      }));
    },
    [
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

      if (existingConnection) {
        existingConnection.disconnect();
      }

      setState((current) => ({
        ...current,
        liveKitError: null,
        liveKitStatus: "connecting",
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
            }));
          },
          onStatusChange: (status) => {
            if (liveKitRequestIdRef.current !== requestId) {
              return;
            }

            if (status === "disconnected") {
              hostPublicationRecoveryRequestedRef.current =
                participantRef.current?.role === "HOST" && filePublicationRef.current !== null;
              filePublicationRequestIdRef.current += 1;
              stopCurrentFilePublication();
              voiceRequestIdRef.current += 1;
              stopCurrentVoicePublication();
              disconnectRemotePlayback();
              disconnectRemoteVoice();
              disconnectPlaybackStateReceiver();
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
        }));
      }
    },
    [
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
      setState((current) => ({
        ...current,
        connectionStatus: "error",
        error: "Не удалось восстановить WebSocket комнаты.",
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
    }));
  }, [clearSocketReconnectTimer]);

  const connectRoomEvents = useCallback(
    (room: RoomSnapshot, participant: Participant, options: ConnectRoomEventsOptions = {}) => {
      const reconnect = options.reconnect ?? false;
      disconnectSocket(reconnect ? "reconnecting" : "connecting", {
        resetReconnect: !reconnect,
      });

      if (!("WebSocket" in window)) {
        setState((current) => ({
          ...current,
          connectionStatus: "error",
          error: "Браузер не поддерживает WebSocket.",
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
          setState((current) => ({
            ...current,
            error: "Получено некорректное событие комнаты.",
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
        }));
      };

      socket.onclose = () => {
        if (socketRef.current !== socket) {
          return;
        }

        socketRef.current = null;
        stopHeartbeat();
        if (pendingActionRef.current !== "close") {
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
          pendingAction: current.pendingAction === "close" ? null : current.pendingAction,
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

  const create = useCallback(
    async (hostDisplayName: string) => {
      const displayName = hostDisplayName.trim();
      if (!displayName) {
        setState((current) => ({ ...current, error: "Укажите имя host." }));
        return;
      }

      setState((current) => ({ ...current, error: null, pendingAction: "create" }));

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
        }));
        connectRoomEvents(result.room, participant);
        void connectLiveKit(result.room);
      } catch (error) {
        setState((current) => ({
          ...current,
          error: getErrorMessage(error),
          pendingAction: null,
        }));
      }
    },
    [connectLiveKit, connectRoomEvents],
  );

  const restore = useCallback(
    async (roomId: string, signal?: AbortSignal) => {
      const normalizedRoomId = extractRoomId(roomId);
      if (!roomIdSchema.safeParse(normalizedRoomId).success) {
        setState((current) => ({ ...current, error: "Проверьте ID комнаты." }));
        return;
      }

      setState((current) => ({ ...current, error: null, pendingAction: "restore" }));

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
        }));
        connectRoomEvents(result.room, result.participant);
        void connectLiveKit(result.room);
      } catch (error) {
        if (signal?.aborted) {
          return;
        }

        setState((current) => ({
          ...current,
          error: getErrorMessage(error),
          pendingAction: null,
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
        setState((current) => ({ ...current, error: "Проверьте ID комнаты." }));
        return;
      }

      if (!displayName) {
        setState((current) => ({ ...current, error: "Укажите имя участника." }));
        return;
      }

      setState((current) => ({ ...current, error: null, pendingAction: "join" }));

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
        }));
        connectRoomEvents(result.room, result.participant);
        void connectLiveKit(result.room);
      } catch (error) {
        setState((current) => ({
          ...current,
          error: getErrorMessage(error),
          pendingAction: null,
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

    setState((current) => ({ ...current, error: null, pendingAction: "leave" }));

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
      setState((current) => ({
        ...current,
        error: getErrorMessage(error),
        pendingAction: null,
      }));
    }
  }, [clearFileState, disconnectLiveKit, disconnectSocket]);

  const close = useCallback(async () => {
    const room = roomRef.current;
    if (!room || !state.hostSecret) {
      setState((current) => ({ ...current, error: "Закрыть комнату может только host." }));
      return;
    }

    pendingActionRef.current = "close";
    setState((current) => ({ ...current, error: null, pendingAction: "close" }));

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
      setState((current) => ({
        ...current,
        error: getErrorMessage(error),
        pendingAction: null,
      }));
    }
  }, [clearFileState, disconnectLiveKit, state.hostSecret]);

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

    if (state.filePublicationStatus === "live" || state.filePublicationStatus === "publishing") {
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

    hostPublicationRecoveryRequestedRef.current = false;
    void publishFile();
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
    hostPause,
    hostPlay,
    hostSeek,
    inviteUrl,
    join,
    leave,
    muteVoiceChat,
    publishFile,
    restore,
    routeRoomId,
    selectFile,
    sendChatMessage,
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
      return { ...current, error: message };
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
  detail?: string;
  title?: string;
} {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const record = payload as Record<string, unknown>;
  return {
    code: typeof record.code === "string" ? record.code : undefined,
    detail: typeof record.detail === "string" ? record.detail : undefined,
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
