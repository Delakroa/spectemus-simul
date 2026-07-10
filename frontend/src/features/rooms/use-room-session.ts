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
  createGuestPlaybackStateReceiver,
  createHostPlaybackStatePublisher,
  type GuestPlaybackStateReceiver,
  type HostPlaybackStatePublisher,
  type PlaybackEvent,
  type PlaybackStatus,
} from "./playback-state";

const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_EVENT_LOG_ITEMS = 8;
const HOST_SECRET_STORAGE_PREFIX = "watch-together.host-secret.";

export type RoomConnectionStatus = "idle" | "connecting" | "open" | "closed" | "error";
export type RoomActionStatus = "create" | "join" | "restore" | "leave" | "close" | null;
export type FileStatus = "idle" | "checking" | "ready" | "error";
export type FilePublicationStatus = "idle" | "publishing" | "live" | "error";

export type { FileDiagnosticsResult, PlaybackStatus, RemotePlaybackElements, RemotePlaybackStatus };

export type RoomEventLogEntry = {
  eventId: string;
  label: string;
  occurredAt: string;
  type: string;
};

export type RoomSessionState = {
  connectionStatus: RoomConnectionStatus;
  error: string | null;
  events: RoomEventLogEntry[];
  fileError: string | null;
  filePublicationError: string | null;
  filePublicationStatus: FilePublicationStatus;
  filePublicationTrackCount: number;
  fileResult: FileDiagnosticsResult | null;
  fileStatus: FileStatus;
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
};

const initialState: RoomSessionState = {
  connectionStatus: "idle",
  error: null,
  events: [],
  fileError: null,
  filePublicationError: null,
  filePublicationStatus: "idle",
  filePublicationTrackCount: 0,
  fileResult: null,
  fileStatus: "idle",
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
};

export function useRoomSession(routeRoomId?: string) {
  const [state, setState] = useState<RoomSessionState>(initialState);
  const fileDiagnosticsRequestIdRef = useRef(0);
  const fileObjectUrlRef = useRef<string | null>(null);
  const filePublicationRef = useRef<FilePublication | null>(null);
  const filePublicationRequestIdRef = useRef(0);
  const heartbeatTimerRef = useRef<number | null>(null);
  const liveKitConnectionRef = useRef<LiveKitConnection | null>(null);
  const liveKitRequestIdRef = useRef(0);
  const participantRef = useRef<Participant | null>(null);
  const playbackStatePublisherRef = useRef<HostPlaybackStatePublisher | null>(null);
  const playbackStateReceiverRef = useRef<GuestPlaybackStateReceiver | null>(null);
  const remotePlaybackControllerRef = useRef<RemotePlaybackController | null>(null);
  const remotePlaybackElementsRef = useRef<RemotePlaybackElements>({
    audioElement: null,
    videoElement: null,
  });
  const restoredRouteRoomIdRef = useRef<string | null>(null);
  const roomRef = useRef<RoomSnapshot | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    participantRef.current = state.participant;
    roomRef.current = state.room;
  }, [state.participant, state.room]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current !== null) {
      window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

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

  const stopCurrentFilePublication = useCallback(() => {
    const publication = filePublicationRef.current;
    filePublicationRef.current = null;
    stopPlaybackStatePublisher();

    if (publication) {
      stopLiveKitFilePublication(liveKitConnectionRef.current?.room ?? null, publication);
    }
  }, [stopPlaybackStatePublisher]);

  const stopFilePublication = useCallback(() => {
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
  }, [state.fileResult, state.liveKitStatus, stopCurrentFilePublication]);

  const disconnectLiveKit = useCallback(
    (nextStatus: LiveKitConnectionStatus = "idle") => {
      liveKitRequestIdRef.current += 1;
      filePublicationRequestIdRef.current += 1;
      stopCurrentFilePublication();
      disconnectRemotePlayback();
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
      }));
    },
    [disconnectPlaybackStateReceiver, disconnectRemotePlayback, stopCurrentFilePublication],
  );

  const disconnectSocket = useCallback(
    (nextStatus: RoomConnectionStatus = "idle") => {
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
    [stopHeartbeat],
  );

  const connectLiveKit = useCallback(
    async (room: RoomSnapshot) => {
      const requestId = liveKitRequestIdRef.current + 1;
      liveKitRequestIdRef.current = requestId;
      const existingConnection = liveKitConnectionRef.current;
      liveKitConnectionRef.current = null;
      stopCurrentFilePublication();
      disconnectRemotePlayback();
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
              filePublicationRequestIdRef.current += 1;
              stopCurrentFilePublication();
              disconnectRemotePlayback();
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
            }));
          },
        });
        if (liveKitRequestIdRef.current !== requestId) {
          connection.disconnect();
          return;
        }

        liveKitConnectionRef.current = connection;
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
    [disconnectPlaybackStateReceiver, disconnectRemotePlayback, stopCurrentFilePublication],
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

  const connectRoomEvents = useCallback(
    (room: RoomSnapshot, participant: Participant) => {
      disconnectSocket("connecting");

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

      const socket = new WebSocket(resolveRoomEventsUrl(room.roomId));
      socketRef.current = socket;

      socket.onopen = () => {
        if (socketRef.current !== socket) {
          return;
        }

        setState((current) => ({
          ...current,
          connectionStatus: "open",
          error: null,
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
          connectionStatus: "error",
          error: "WebSocket комнаты недоступен.",
        }));
      };

      socket.onclose = () => {
        if (socketRef.current !== socket) {
          return;
        }

        socketRef.current = null;
        stopHeartbeat();
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
    [clearFileState, disconnectLiveKit, disconnectSocket, sendHeartbeat, stopHeartbeat],
  );

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

  const inviteUrl = useMemo(() => {
    const path = state.invitePath ?? (state.room ? `/rooms/${state.room.roomId}` : null);
    return path ? new URL(path, window.location.origin).toString() : null;
  }, [state.invitePath, state.room]);

  return {
    ...state,
    close,
    create,
    inviteUrl,
    join,
    leave,
    publishFile,
    restore,
    routeRoomId,
    selectFile,
    setRemotePlaybackElements,
    stopFilePublication,
  };
}

function applyEventToState(current: RoomSessionState, event: RoomServerEvent): RoomSessionState {
  const nextRoom = isKnownRoomServerEvent(event)
    ? applyRoomServerEvent(current.room, event)
    : current.room;
  const nextParticipant = syncParticipant(current.participant, nextRoom);

  return {
    ...current,
    connectionStatus: event.type === "room.closed" ? "closed" : current.connectionStatus,
    error: null,
    events: addServerEvent(current.events, event),
    participant: nextParticipant,
    pendingAction: event.type === "room.closed" ? null : current.pendingAction,
    room: nextRoom,
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
