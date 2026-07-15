import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Activity,
  AlertTriangle,
  CircleCheck,
  Clapperboard,
  Copy,
  DoorOpen,
  FileVideo,
  FolderOpen,
  Link as LinkIcon,
  LogIn,
  Maximize2,
  MessageSquare,
  Mic,
  MicOff,
  MonitorPlay,
  Pause,
  Play,
  Plus,
  Power,
  Radio,
  RefreshCw,
  Send,
  Server,
  Square,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { useParams } from "react-router-dom";

import {
  type FeedbackClientMetadata,
  type FeedbackOutcome,
  type FeedbackReason,
  type FeedbackResponse,
  submitFeedback,
} from "../features/feedback/feedback-api";
import { ApiProblemError, type Participant, type RoomSnapshot } from "../features/rooms/room-api";
import { type LiveKitConnectionStatus } from "../features/rooms/livekit-connection";
import {
  type FilePublicationStatus,
  type PlaybackStatus,
  type QualityIndicatorsState,
  type RemotePlaybackStatus,
  type RoomConnectionStatus,
  type RoomUserError,
  type RoomUserErrorAction,
  type VoiceChatStatus,
  useRoomSession,
} from "../features/rooms/use-room-session";
import {
  LOCAL_MEDIA_FILE_ACCEPT,
  LOCAL_MEDIA_FORMATS_HINT,
} from "../features/rooms/file-diagnostics";
import { useSystemStatus } from "../features/system/use-system-status";

function formatCheckedAt(value?: string) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

type FullscreenTarget = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenVideoTarget = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
};

type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

type QualityDisplayStatus = QualityIndicatorsState["status"] | "reconnecting";
type FeedbackSubmitStatus = "idle" | "sending" | "sent" | "error";

const FEEDBACK_OUTCOME_OPTIONS: Array<{ value: FeedbackOutcome; label: string }> = [
  { value: "WORKED", label: "Работает" },
  { value: "ISSUE", label: "Есть проблема" },
  { value: "BLOCKED", label: "Заблокировало" },
];

const FEEDBACK_REASON_OPTIONS: Array<{ value: FeedbackReason; label: string }> = [
  { value: "SUCCESS", label: "Всё хорошо" },
  { value: "CONNECTION", label: "Связь" },
  { value: "AUDIO_VIDEO", label: "Видео/звук" },
  { value: "FILE", label: "Файл" },
  { value: "VOICE", label: "Голос" },
  { value: "SYNC", label: "Синхронизация" },
  { value: "CHAT", label: "Чат" },
  { value: "ROOM_ACCESS", label: "Вход/комната" },
  { value: "PERFORMANCE", label: "Производительность" },
  { value: "OTHER", label: "Другое" },
];

type NetworkInformationSnapshot = {
  downlink?: number;
  effectiveType?: string;
  rtt?: number;
  saveData?: boolean;
};

type NavigatorWithNetworkInformation = Navigator & {
  connection?: NetworkInformationSnapshot;
  mozConnection?: NetworkInformationSnapshot;
  webkitConnection?: NetworkInformationSnapshot;
};

async function toggleFullscreen(element: HTMLElement | null) {
  if (!element) {
    return;
  }

  const fullscreenDocument = document as FullscreenDocument;
  const activeElement = document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement;

  try {
    if (activeElement) {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
        return;
      }

      await fullscreenDocument.webkitExitFullscreen?.();
      return;
    }

    const fullscreenTarget = element as FullscreenTarget;
    if (element.requestFullscreen) {
      await element.requestFullscreen();
      return;
    }

    if (fullscreenTarget.webkitRequestFullscreen) {
      await fullscreenTarget.webkitRequestFullscreen();
      return;
    }

    const videoTarget = element.querySelector("video") as FullscreenVideoTarget | null;
    videoTarget?.webkitEnterFullscreen?.();
  } catch {
    // Fullscreen can be denied by browser policy; keep playback running.
  }
}

export function HomePage() {
  const { roomId: routeRoomId } = useParams();
  const { health, version, isPending, isError, refetch } = useSystemStatus();
  const roomSession = useRoomSession(routeRoomId);
  const { setHostPreviewElement, setRemotePlaybackElements } = roomSession;
  const [hostDisplayName, setHostDisplayName] = useState("Host");
  const [guestDisplayName, setGuestDisplayName] = useState("Guest");
  const [joinRoomIdDraft, setJoinRoomIdDraft] = useState("");
  const [isFileDropActive, setIsFileDropActive] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [roomIdCopied, setRoomIdCopied] = useState(false);
  const [seekBarValue, setSeekBarValue] = useState<number | null>(null);
  const [chatDraft, setChatDraft] = useState("");
  const [feedbackOutcome, setFeedbackOutcome] = useState<FeedbackOutcome>("WORKED");
  const [feedbackReason, setFeedbackReason] = useState<FeedbackReason>("SUCCESS");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [includeFeedbackMetadata, setIncludeFeedbackMetadata] = useState(true);
  const [feedbackStatus, setFeedbackStatus] = useState<FeedbackSubmitStatus>("idle");
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackReceipt, setFeedbackReceipt] = useState<FeedbackResponse | null>(null);
  const joinRoomId = joinRoomIdDraft || routeRoomId || "";
  const isOnline = !isPending && !isError;
  const room = roomSession.room;
  const participant = roomSession.participant;
  const roomClosed = room?.status === "CLOSED" || room?.status === "EXPIRED";
  const isHost = participant?.role === "HOST";
  const isRoomActionPending = roomSession.pendingAction !== null;
  const isFilePublishing = roomSession.filePublicationStatus === "publishing";
  const canPublishFile =
    roomSession.fileStatus === "ready" &&
    roomSession.liveKitStatus === "connected" &&
    !isFilePublishing;
  const canStopFilePublication =
    roomSession.filePublicationStatus === "publishing" ||
    roomSession.filePublicationStatus === "live";
  const canUseVoice = roomSession.liveKitStatus === "connected" && !roomClosed;
  const isVoiceActive =
    roomSession.voiceStatus === "live" ||
    roomSession.voiceStatus === "muted" ||
    roomSession.voiceStatus === "requesting";
  const qualityDisplayStatus = getQualityDisplayStatus(
    roomSession.liveKitStatus,
    roomSession.qualityIndicators.status,
  );
  const watchPlaybackStatus = isHost
    ? toHostWatchPlaybackStatus(roomSession.filePublicationStatus)
    : roomSession.remotePlaybackStatus;
  const showWatchSurface = !roomClosed && (isHost ? canStopFilePublication : !isHost);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hostPreviewVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const watchPlayerRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLLIElement>(null);
  const chatMessageCount = roomSession.chatMessages.length;

  useEffect(() => {
    setRemotePlaybackElements({
      audioElement: remoteAudioRef.current,
      videoElement: remoteVideoRef.current,
    });

    return () => {
      setRemotePlaybackElements({
        audioElement: null,
        videoElement: null,
      });
    };
  }, [isHost, room?.roomId, roomClosed, setRemotePlaybackElements]);

  useEffect(() => {
    if (!isHost || roomClosed) {
      setHostPreviewElement(null);
      return undefined;
    }

    setHostPreviewElement(hostPreviewVideoRef.current);

    return () => {
      setHostPreviewElement(null);
    };
  }, [isHost, room?.roomId, roomClosed, roomSession.filePublicationStatus, setHostPreviewElement]);

  useEffect(() => {
    const node = chatEndRef.current;
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "nearest" });
    }
  }, [chatMessageCount]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    selectLocalFile(file);
    event.target.value = "";
  }

  function selectLocalFile(file: File | undefined) {
    if (file) {
      void roomSession.selectFile(file);
    }
  }

  function handleFileDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsFileDropActive(true);
  }

  function handleFileDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsFileDropActive(false);
    selectLocalFile(event.dataTransfer.files?.[0]);
  }

  function handleCreateRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void roomSession.create(hostDisplayName);
  }

  function handleJoinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void roomSession.join(joinRoomId, guestDisplayName);
  }

  function handleToggleWatchFullscreen() {
    void toggleFullscreen(watchPlayerRef.current);
  }

  function handleUserErrorAction(action: RoomUserErrorAction) {
    switch (action) {
      case "retry-room-action":
        roomSession.retryLastRoomAction();
        break;
      case "retry-websocket":
        roomSession.retryRoomConnection();
        break;
      case "retry-livekit":
        roomSession.retryLiveKitConnection();
        break;
    }
  }

  function handleSendChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (roomSession.sendChatMessage(chatDraft)) {
      setChatDraft("");
    }
  }

  function handleFeedbackOutcomeChange(nextOutcome: FeedbackOutcome) {
    setFeedbackOutcome(nextOutcome);
    setFeedbackReason((currentReason) => {
      if (nextOutcome === "WORKED") {
        return "SUCCESS";
      }

      return currentReason === "SUCCESS" ? "OTHER" : currentReason;
    });
  }

  async function handleSubmitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedbackStatus("sending");
    setFeedbackError(null);
    setFeedbackReceipt(null);

    try {
      const response = await submitFeedback({
        outcome: feedbackOutcome,
        reason: feedbackReason,
        message: feedbackMessage.trim() || undefined,
        roomId: room?.roomId,
        participantRole: participant?.role,
        relatedCorrelationId: normalizeUuid(roomSession.userError?.correlationId),
        metadata: includeFeedbackMetadata ? collectFeedbackMetadata() : undefined,
      });

      setFeedbackReceipt(response);
      setFeedbackMessage("");
      setFeedbackStatus("sent");
    } catch (error) {
      setFeedbackStatus("error");
      setFeedbackError(formatFeedbackSubmitError(error));
    }
  }

  function collectFeedbackMetadata(): FeedbackClientMetadata {
    const connection = getNetworkInformation();

    return {
      userAgent: navigator.userAgent || undefined,
      language: navigator.language || undefined,
      platform: navigator.platform || undefined,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      networkEffectiveType: connection?.effectiveType,
      networkDownlinkMbps: connection?.downlink,
      networkRttMs: connection?.rtt,
      networkSaveData: connection?.saveData,
      roomStatus: room?.status,
      roomConnectionStatus: roomSession.connectionStatus,
      liveKitStatus: roomSession.liveKitStatus,
      qualityStatus: roomSession.qualityIndicators.status,
      participantCount: room?.participants.length,
    };
  }

  async function handleCopyInvite() {
    if (!roomSession.inviteUrl) {
      return;
    }

    await navigator.clipboard.writeText(roomSession.inviteUrl);
    setInviteCopied(true);
    window.setTimeout(() => setInviteCopied(false), 1800);
  }

  async function handleCopyRoomId() {
    if (!room) {
      return;
    }

    await navigator.clipboard.writeText(room.roomId);
    setRoomIdCopied(true);
    window.setTimeout(() => setRoomIdCopied(false), 1800);
  }

  return (
    <div className={`home ${room && !roomClosed ? "home--room" : "home--entry"}`}>
      {!room && (
        <section className="hero" aria-labelledby="home-title">
          <div className="hero__content">
            <p className="eyebrow">Один вечер. Один экран.</p>
            <h1 id="home-title">Смотрите вместе, даже когда вы далеко</h1>
            <p className="hero__lead">
              Запускайте любимое видео и оставайтесь рядом с теми, кто важен.
            </p>

            <div
              className={`service-status service-status--${
                isPending ? "pending" : isError ? "error" : "online"
              }`}
              role="status"
            >
              <span className="service-status__indicator" aria-hidden="true" />
              {isPending && "Подключаемся к сервису"}
              {isError && "Сервис временно недоступен"}
              {isOnline && "Сервис готов"}
            </div>
          </div>

          <div className="watch-stage" aria-label="Экран совместного просмотра">
            <div className="watch-stage__topline">
              <span className="watch-stage__label">Приватная комната</span>
              <span className="watch-stage__state">Готова к началу</span>
            </div>

            <div className="watch-stage__empty">
              <span className="watch-stage__icon" aria-hidden="true">
                <Clapperboard size={34} />
              </span>
              <strong>Создайте комнату и выберите свой видеофайл</strong>
            </div>

            <div className="watch-stage__timeline" aria-hidden="true">
              <span style={{ width: "0%" }} />
            </div>
          </div>
        </section>
      )}

      <section
        className={`room-workspace${room && !roomClosed ? " room-workspace--active" : ""}`}
        aria-labelledby="room-workspace-title"
      >
        <div className="room-workspace__heading">
          <div>
            <p className="eyebrow">{room ? "Private review room" : "Ваша комната"}</p>
            {room ? (
              <h1 id="room-workspace-title">Комната {formatShortRoomId(room.roomId)}</h1>
            ) : (
              <h2 id="room-workspace-title">Начните совместный просмотр</h2>
            )}
          </div>
          {room && (
            <div className="room-connection-group">
              <span
                className={`room-connection room-connection--${roomSession.connectionStatus}`}
                role="status"
              >
                {roomSession.connectionStatus === "open" ? (
                  <Wifi size={17} aria-hidden="true" />
                ) : (
                  <WifiOff size={17} aria-hidden="true" />
                )}
                {formatConnectionStatus(roomSession.connectionStatus)}
              </span>
              <span
                className={`room-connection room-connection--${roomSession.liveKitStatus}`}
                role="status"
              >
                {roomSession.liveKitStatus === "connected" ? (
                  <Wifi size={17} aria-hidden="true" />
                ) : (
                  <WifiOff size={17} aria-hidden="true" />
                )}
                LiveKit: {formatLiveKitStatus(roomSession.liveKitStatus)}
              </span>
            </div>
          )}
        </div>

        {(!room || roomClosed) && (
          <div className="room-actions">
            <form className="room-form" onSubmit={handleCreateRoom}>
              <label htmlFor="host-display-name">Создать комнату</label>
              <div className="room-form__row">
                <input
                  aria-label="Имя host"
                  id="host-display-name"
                  maxLength={64}
                  minLength={1}
                  name="hostDisplayName"
                  onChange={(event) => setHostDisplayName(event.target.value)}
                  required
                  type="text"
                  value={hostDisplayName}
                />
                <button
                  className="button button--primary"
                  disabled={isRoomActionPending}
                  type="submit"
                >
                  <Plus size={18} aria-hidden="true" />
                  Создать
                </button>
              </div>
            </form>

            <form className="room-form" onSubmit={handleJoinRoom}>
              <label htmlFor="join-room-id">Войти гостем</label>
              <div className="room-form__grid">
                <input
                  aria-label="Invite-ссылка или ID комнаты"
                  id="join-room-id"
                  maxLength={220}
                  minLength={1}
                  name="roomId"
                  onChange={(event) => setJoinRoomIdDraft(event.target.value)}
                  required
                  type="text"
                  value={joinRoomId}
                />
                <input
                  aria-label="Имя гостя"
                  maxLength={64}
                  minLength={1}
                  name="guestDisplayName"
                  onChange={(event) => setGuestDisplayName(event.target.value)}
                  required
                  type="text"
                  value={guestDisplayName}
                />
                <button className="button" disabled={isRoomActionPending} type="submit">
                  <LogIn size={18} aria-hidden="true" />
                  Войти
                </button>
              </div>
            </form>
          </div>
        )}

        {roomSession.userError ? (
          <UserErrorBanner
            error={roomSession.userError}
            onAction={handleUserErrorAction}
            onDismiss={roomSession.clearUserError}
          />
        ) : (
          <>
            {roomSession.error && (
              <div className="system-message system-message--error" role="alert">
                <WifiOff size={22} aria-hidden="true" />
                <div>
                  <strong>Действие не выполнено</strong>
                  <span>{roomSession.error}</span>
                </div>
              </div>
            )}

            {roomSession.liveKitError && (
              <div className="system-message system-message--error" role="alert">
                <WifiOff size={22} aria-hidden="true" />
                <div>
                  <strong>LiveKit не подключён</strong>
                  <span>{roomSession.liveKitError}</span>
                </div>
              </div>
            )}
          </>
        )}

        {room?.status === "HOST_DISCONNECTED" && (
          <div className="system-message system-message--warning" role="status">
            <WifiOff size={22} aria-hidden="true" />
            <div>
              <strong>Host отключился</strong>
              <span>
                Ждём переподключения
                {roomSession.hostReconnectDeadline
                  ? ` до ${formatCheckedAt(roomSession.hostReconnectDeadline)}`
                  : ""}
                …
              </span>
            </div>
          </div>
        )}

        {room && (
          <div className={`room-dashboard room-dashboard--${isHost ? "host" : "guest"}`}>
            {isHost && !roomClosed && (
              <section className="room-card room-card--file" aria-labelledby="file-picker-title">
                <div className="room-card__heading">
                  <h3 id="file-picker-title">Видеофайл</h3>
                  {roomSession.fileStatus === "ready" && (
                    <span
                      className={`room-pill room-pill--file-${roomSession.filePublicationStatus}`}
                    >
                      <Radio size={15} aria-hidden="true" />
                      {formatFilePublicationStatus(
                        roomSession.filePublicationStatus,
                        roomSession.filePublicationTrackCount,
                      )}
                    </span>
                  )}
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept={LOCAL_MEDIA_FILE_ACCEPT}
                  aria-hidden="true"
                  style={{ display: "none" }}
                  tabIndex={-1}
                  onChange={handleFileChange}
                />

                <div
                  className={`file-picker file-picker--dropzone${
                    isFileDropActive ? " file-picker--dropzone-active" : ""
                  }`}
                  onDragLeave={() => setIsFileDropActive(false)}
                  onDragOver={handleFileDragOver}
                  onDrop={handleFileDrop}
                >
                  <button
                    className="button file-picker__trigger"
                    type="button"
                    aria-describedby="file-picker-help"
                    disabled={roomSession.fileStatus === "checking" || isFilePublishing}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <FolderOpen size={18} aria-hidden="true" />
                    {roomSession.fileStatus === "checking" ? "Проверка…" : "Выбрать файл"}
                  </button>

                  {roomSession.fileStatus === "ready" && roomSession.fileResult && (
                    <div className="file-picker__info">
                      <span className="file-picker__name">
                        <FileVideo size={15} aria-hidden="true" />
                        {roomSession.fileResult.displayName}
                      </span>
                      <span className="file-picker__meta">
                        {roomSession.fileResult.formatLabel} · {roomSession.fileResult.width}×
                        {roomSession.fileResult.height} ·{" "}
                        {formatDurationMs(roomSession.fileResult.durationMs)}
                        {roomSession.fileResult.hasAudio ? " · со звуком" : " · без звука"}
                      </span>
                      <span className="file-picker__verdict">
                        Проверено: {roomSession.fileResult.verdictLabel}
                      </span>
                    </div>
                  )}

                  {roomSession.fileStatus === "ready" && (
                    <div className="file-picker__actions">
                      <button
                        className="button button--primary"
                        type="button"
                        disabled={!canPublishFile}
                        onClick={() => void roomSession.publishFile()}
                      >
                        <Radio size={18} aria-hidden="true" />
                        {isFilePublishing ? "Публикуется…" : "Опубликовать"}
                      </button>
                      <button
                        className="button"
                        type="button"
                        disabled={!canStopFilePublication}
                        onClick={() => roomSession.stopFilePublication()}
                      >
                        <Square size={16} aria-hidden="true" />
                        Остановить
                      </button>
                    </div>
                  )}

                  {roomSession.filePublicationError && (
                    <div className="inline-error" role="alert">
                      <p>{roomSession.filePublicationError}</p>
                      {roomSession.filePublicationStatus === "error" && (
                        <button
                          className="button"
                          type="button"
                          disabled={!canPublishFile}
                          onClick={() => void roomSession.publishFile()}
                        >
                          <RefreshCw size={16} aria-hidden="true" />
                          Повторить
                        </button>
                      )}
                    </div>
                  )}

                  {roomSession.fileStatus === "error" && roomSession.fileError && (
                    <div className="inline-error" role="alert">
                      <p>{roomSession.fileError}</p>
                      <button
                        className="button"
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <FolderOpen size={16} aria-hidden="true" />
                        Другой файл
                      </button>
                    </div>
                  )}
                </div>
                <p className="file-picker__hint" id="file-picker-help">
                  <span>Перетащите файл сюда или выберите его с устройства. </span>
                  <span>{LOCAL_MEDIA_FORMATS_HINT}</span>
                </p>

                {roomSession.filePublicationStatus === "live" && (
                  <div className="host-controls" aria-label="Управление воспроизведением">
                    <div className="host-controls__buttons">
                      {roomSession.hostPlaybackStatus === "playing" ? (
                        <button
                          className="button host-controls__play"
                          type="button"
                          onClick={() => roomSession.hostPause()}
                          aria-label="Пауза"
                        >
                          <Pause size={18} aria-hidden="true" />
                          Пауза
                        </button>
                      ) : (
                        <button
                          className="button button--primary host-controls__play"
                          type="button"
                          disabled={roomSession.hostPlaybackStatus === "ended"}
                          onClick={() => void roomSession.hostPlay()}
                          aria-label="Воспроизвести"
                        >
                          <Play size={18} aria-hidden="true" />
                          Играть
                        </button>
                      )}
                      <span className="host-controls__time">
                        {formatDurationMs(
                          (seekBarValue ?? roomSession.hostPlaybackCurrentTime) * 1000,
                        )}
                        {roomSession.hostPlaybackDuration
                          ? ` / ${formatDurationMs(roomSession.hostPlaybackDuration * 1000)}`
                          : ""}
                      </span>
                    </div>

                    <input
                      className="host-controls__seek"
                      type="range"
                      min={0}
                      max={roomSession.hostPlaybackDuration ?? 0}
                      step={0.5}
                      value={seekBarValue ?? roomSession.hostPlaybackCurrentTime}
                      aria-label="Перемотка"
                      onChange={(e) => setSeekBarValue(Number(e.target.value))}
                      onPointerUp={(e) => {
                        roomSession.hostSeek(Number((e.target as HTMLInputElement).value));
                        setSeekBarValue(null);
                      }}
                    />

                    {roomSession.hostPlaybackError && (
                      <p className="file-picker__error" role="alert">
                        {roomSession.hostPlaybackError}
                      </p>
                    )}
                  </div>
                )}
              </section>
            )}

            {showWatchSurface && (
              <section
                className="room-card room-card--remote-playback"
                aria-labelledby="remote-playback-title"
              >
                <div className="room-card__heading">
                  <h3 id="remote-playback-title">Просмотр</h3>
                  <span className={`room-pill room-pill--remote-${watchPlaybackStatus}`}>
                    <MonitorPlay size={15} aria-hidden="true" />
                    {isHost
                      ? formatHostWatchPlaybackStatus(roomSession.filePublicationStatus)
                      : formatRemotePlaybackStatus(roomSession.remotePlaybackStatus)}
                  </span>
                </div>

                <div className="remote-player" ref={watchPlayerRef}>
                  {isHost ? (
                    <video
                      ref={hostPreviewVideoRef}
                      className="remote-player__video"
                      autoPlay
                      playsInline
                    />
                  ) : (
                    <>
                      <video
                        ref={remoteVideoRef}
                        className="remote-player__video"
                        autoPlay
                        playsInline
                      />
                      <audio ref={remoteAudioRef} autoPlay />
                    </>
                  )}

                  {watchPlaybackStatus !== "receiving" && (
                    <div className="remote-player__overlay">
                      <MonitorPlay size={34} aria-hidden="true" />
                      <strong>
                        {isHost
                          ? formatHostWatchPlaybackStatus(roomSession.filePublicationStatus)
                          : formatRemotePlaybackStatus(roomSession.remotePlaybackStatus)}
                      </strong>
                      <span>
                        {isHost
                          ? formatHostWatchPlaybackHint(roomSession.filePublicationStatus)
                          : formatRemotePlaybackHint(roomSession.remotePlaybackStatus)}
                      </span>
                    </div>
                  )}

                  <button
                    className="icon-button remote-player__fullscreen"
                    type="button"
                    aria-label="Развернуть видео на весь экран"
                    title="На весь экран"
                    onClick={handleToggleWatchFullscreen}
                  >
                    <Maximize2 size={18} aria-hidden="true" />
                  </button>
                </div>

                <div className="remote-player__meta">
                  {isHost ? (
                    <>
                      <span>{formatTrackCount(roomSession.filePublicationTrackCount)}</span>
                      {participant && <span>{participant.displayName}</span>}
                      {roomSession.fileResult && <span>{roomSession.fileResult.displayName}</span>}
                    </>
                  ) : (
                    <>
                      <span>{formatTrackCount(roomSession.remotePlaybackTrackCount)}</span>
                      {roomSession.remotePlaybackParticipantIdentity && (
                        <span>{roomSession.remotePlaybackParticipantIdentity}</span>
                      )}
                      {roomSession.remotePlaybackVideoTrackName && (
                        <span>{roomSession.remotePlaybackVideoTrackName}</span>
                      )}
                      {roomSession.remotePlaybackAudioTrackName && (
                        <span>{roomSession.remotePlaybackAudioTrackName}</span>
                      )}
                    </>
                  )}
                </div>

                {!isHost && (
                  <div className="playback-sync" aria-label="Host playback">
                    <span>Host playback</span>
                    <strong>{formatPlaybackSyncStatus(roomSession.playbackSyncStatus)}</strong>
                    <span>
                      {formatPlaybackSyncTime(
                        roomSession.playbackSyncCurrentTime,
                        roomSession.playbackSyncDuration,
                      )}
                    </span>
                    <span>rev {roomSession.playbackSyncRevision}</span>
                    {roomSession.playbackSyncFileName && (
                      <span>{roomSession.playbackSyncFileName}</span>
                    )}
                  </div>
                )}

                {!isHost && roomSession.remotePlaybackError && (
                  <p className="file-picker__error" role="alert">
                    {roomSession.remotePlaybackError}
                  </p>
                )}

                {!isHost && roomSession.playbackSyncError && (
                  <p className="file-picker__error" role="alert">
                    {roomSession.playbackSyncError}
                  </p>
                )}
              </section>
            )}

            {!roomClosed && (
              <section className="room-card room-card--voice" aria-labelledby="voice-chat-title">
                <div className="room-card__heading">
                  <h3 id="voice-chat-title">Голос</h3>
                  <span className={`room-pill room-pill--voice-${roomSession.voiceStatus}`}>
                    {roomSession.voiceStatus === "live" ? (
                      <Mic size={15} aria-hidden="true" />
                    ) : (
                      <MicOff size={15} aria-hidden="true" />
                    )}
                    {formatVoiceStatus(roomSession.voiceStatus)}
                  </span>
                </div>

                <div className="voice-controls">
                  {roomSession.voiceStatus === "live" ? (
                    <button
                      className="button"
                      type="button"
                      disabled={!canUseVoice}
                      onClick={() => void roomSession.muteVoiceChat()}
                    >
                      <MicOff size={17} aria-hidden="true" />
                      Выключить звук
                    </button>
                  ) : roomSession.voiceStatus === "muted" ? (
                    <button
                      className="button button--primary"
                      type="button"
                      disabled={!canUseVoice}
                      onClick={() => void roomSession.unmuteVoiceChat()}
                    >
                      <Mic size={17} aria-hidden="true" />
                      Включить звук
                    </button>
                  ) : (
                    <button
                      className="button button--primary"
                      type="button"
                      disabled={!canUseVoice || roomSession.voiceStatus === "requesting"}
                      onClick={() => void roomSession.startVoiceChat()}
                    >
                      <Mic size={17} aria-hidden="true" />
                      {roomSession.voiceStatus === "requesting"
                        ? "Запрашиваем…"
                        : "Включить микрофон"}
                    </button>
                  )}

                  <button
                    className="button"
                    type="button"
                    aria-label="Остановить голос"
                    disabled={!isVoiceActive}
                    onClick={() => roomSession.stopVoiceChat()}
                  >
                    <Square size={16} aria-hidden="true" />
                    Остановить
                  </button>
                </div>

                <div className="voice-meta">
                  <span>{formatVoiceRemoteCount(roomSession.voiceRemoteParticipantCount)}</span>
                  {roomSession.voiceRemoteParticipantIdentities.slice(0, 2).map((identity) => (
                    <span key={identity}>{identity}</span>
                  ))}
                </div>

                {(roomSession.voiceError || roomSession.voiceRemoteError) && (
                  <div className="inline-error" role="alert">
                    <p>{roomSession.voiceError ?? roomSession.voiceRemoteError}</p>
                    {roomSession.voiceError && (
                      <button
                        className="button"
                        type="button"
                        disabled={!canUseVoice || roomSession.voiceStatus === "requesting"}
                        onClick={() => void roomSession.startVoiceChat()}
                      >
                        <RefreshCw size={16} aria-hidden="true" />
                        Повторить
                      </button>
                    )}
                  </div>
                )}
              </section>
            )}

            {!roomClosed && (
              <details className="workspace-diagnostics">
                <summary>
                  <span>
                    <Activity size={17} aria-hidden="true" />
                    Диагностика сеанса
                  </span>
                </summary>
                <section className="room-card room-card--quality" aria-labelledby="quality-title">
                  <div className="room-card__heading">
                    <h3 id="quality-title">Качество</h3>
                    <span className={`room-pill room-pill--quality-${qualityDisplayStatus}`}>
                      <Activity size={15} aria-hidden="true" />
                      {formatQualityStatus(qualityDisplayStatus)}
                    </span>
                  </div>

                  <dl className="quality-metrics">
                    <div>
                      <dt>Upload</dt>
                      <dd>{formatBitrate(roomSession.qualityIndicators.upload.bitrateKbps)}</dd>
                    </div>
                    <div>
                      <dt>Download</dt>
                      <dd>{formatBitrate(roomSession.qualityIndicators.download.bitrateKbps)}</dd>
                    </div>
                    <div>
                      <dt>RTT</dt>
                      <dd>{formatMetricMs(roomSession.qualityIndicators.upload.rttMs)}</dd>
                    </div>
                    <div>
                      <dt>Jitter</dt>
                      <dd>{formatMetricMs(getWorstJitter(roomSession.qualityIndicators))}</dd>
                    </div>
                    <div>
                      <dt>Потери</dt>
                      <dd>{formatPacketLoss(getWorstPacketLoss(roomSession.qualityIndicators))}</dd>
                    </div>
                    <div>
                      <dt>Видео</dt>
                      <dd>{formatQualityResolution(roomSession.qualityIndicators)}</dd>
                    </div>
                  </dl>

                  <p className={`quality-hint quality-hint--${qualityDisplayStatus}`}>
                    {formatQualityHint(
                      qualityDisplayStatus,
                      roomSession.liveKitStatus,
                      roomSession.qualityIndicators.warning,
                    )}
                  </p>
                </section>
              </details>
            )}

            <details className="workspace-diagnostics workspace-diagnostics--room">
              <summary>
                <span>
                  <CircleCheck size={17} aria-hidden="true" />
                  Комната и события
                </span>
              </summary>
              <div className="workspace-diagnostics__content">
                <section
                  className="room-card room-card--details"
                  aria-labelledby="room-details-title"
                >
                  <div className="room-card__heading">
                    <h3 id="room-details-title">Состояние комнаты</h3>
                    <span className={`room-pill room-pill--${room.status.toLowerCase()}`}>
                      {formatRoomStatus(room.status)}
                    </span>
                  </div>

                  <dl className="room-metrics">
                    <div>
                      <dt>ID</dt>
                      <dd>{formatShortRoomId(room.roomId)}</dd>
                    </div>
                    <div>
                      <dt>Версия</dt>
                      <dd>{room.roomVersion}</dd>
                    </div>
                    <div>
                      <dt>До</dt>
                      <dd>{formatCheckedAt(room.expiresAt)}</dd>
                    </div>
                  </dl>

                  <div className="room-copy-list">
                    <div className="room-copy-field">
                      <span>ID комнаты</span>
                      <code>{room.roomId}</code>
                      <button
                        className="icon-button"
                        type="button"
                        onClick={() => void handleCopyRoomId()}
                        aria-label="Скопировать ID комнаты"
                        title={roomIdCopied ? "Скопировано" : "Скопировать ID комнаты"}
                      >
                        <Copy size={17} aria-hidden="true" />
                      </button>
                    </div>

                    {roomSession.inviteUrl && (
                      <div className="room-copy-field">
                        <span>
                          <LinkIcon size={15} aria-hidden="true" />
                          Invite
                        </span>
                        <a href={roomSession.inviteUrl}>{roomSession.inviteUrl}</a>
                        <button
                          className="icon-button"
                          type="button"
                          onClick={() => void handleCopyInvite()}
                          aria-label="Скопировать приглашение"
                          title={inviteCopied ? "Скопировано" : "Скопировать приглашение"}
                        >
                          <Copy size={17} aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="room-card__commands">
                    {isHost ? (
                      <button
                        className="button button--danger"
                        disabled={isRoomActionPending || roomClosed}
                        onClick={() => void roomSession.close()}
                        type="button"
                      >
                        <Power size={18} aria-hidden="true" />
                        Закрыть
                      </button>
                    ) : (
                      <button
                        className="button"
                        disabled={isRoomActionPending || roomClosed}
                        onClick={() => void roomSession.leave()}
                        type="button"
                      >
                        <DoorOpen size={18} aria-hidden="true" />
                        Выйти
                      </button>
                    )}
                  </div>
                </section>

                <section className="room-card room-card--events" aria-labelledby="events-title">
                  <div className="room-card__heading">
                    <h3 id="events-title">События</h3>
                  </div>

                  {roomSession.events.length > 0 ? (
                    <ol className="event-list">
                      {roomSession.events.map((event) => (
                        <li key={event.eventId}>
                          <time dateTime={event.occurredAt}>
                            {formatCheckedAt(event.occurredAt)}
                          </time>
                          <span>{event.label}</span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="room-card__empty">Событий пока нет</p>
                  )}
                </section>
              </div>
            </details>

            <section
              className="room-card room-card--participants"
              aria-labelledby="participants-title"
            >
              <div className="room-card__heading">
                <h3 id="participants-title">Участники</h3>
                <span className="room-count">
                  <Users size={17} aria-hidden="true" />
                  {room.participants.length}/4
                </span>
              </div>

              <ul className="participant-list">
                {room.participants.map((item) => (
                  <ParticipantListItem key={item.participantId} participant={item} />
                ))}
              </ul>
            </section>

            <section className="room-card room-card--chat" aria-labelledby="chat-title">
              <div className="room-card__heading">
                <h3 id="chat-title">Чат</h3>
                <span className="room-count">
                  <MessageSquare size={16} aria-hidden="true" />
                  {roomSession.chatMessages.length}
                </span>
              </div>

              <div className="room-rail-tabs" aria-label="Разделы комнаты">
                <span className="room-rail-tabs__item room-rail-tabs__item--active">
                  <MessageSquare size={14} aria-hidden="true" />
                  Чат
                </span>
                <span className="room-rail-tabs__item">
                  <Users size={14} aria-hidden="true" />
                  {room.participants.length}
                </span>
                <span className="room-rail-tabs__item room-rail-tabs__item--muted">
                  Заметки · скоро
                </span>
              </div>

              {roomSession.chatMessages.length > 0 ? (
                <ol className="chat-list">
                  {roomSession.chatMessages.map((message) =>
                    message.kind === "system" ? (
                      <li key={message.id} className="chat-message chat-message--system">
                        <span>{message.text}</span>
                        <time dateTime={message.sentAt}>{formatCheckedAt(message.sentAt)}</time>
                      </li>
                    ) : (
                      <li
                        key={message.id}
                        className={`chat-message${
                          message.participantId === participant?.participantId
                            ? " chat-message--own"
                            : ""
                        }`}
                      >
                        <div className="chat-message__meta">
                          <strong>{message.displayName}</strong>
                          <time dateTime={message.sentAt}>{formatCheckedAt(message.sentAt)}</time>
                        </div>
                        <span className="chat-message__text">{message.text}</span>
                      </li>
                    ),
                  )}
                  <li ref={chatEndRef} className="chat-list__anchor" aria-hidden="true" />
                </ol>
              ) : (
                <p className="room-card__empty">Сообщений пока нет</p>
              )}

              <form className="chat-form" onSubmit={handleSendChat}>
                <input
                  type="text"
                  value={chatDraft}
                  maxLength={1000}
                  onChange={(event) => setChatDraft(event.target.value)}
                  placeholder={roomClosed ? "Комната закрыта" : "Написать сообщение…"}
                  disabled={roomSession.connectionStatus !== "open" || roomClosed}
                  aria-label="Сообщение в чат"
                  autoComplete="off"
                />
                <button
                  className="button button--primary"
                  type="submit"
                  disabled={
                    roomSession.connectionStatus !== "open" ||
                    roomClosed ||
                    chatDraft.trim().length === 0
                  }
                >
                  <Send size={16} aria-hidden="true" />
                  Отправить
                </button>
              </form>

              {roomSession.chatError && (
                <p className="chat-form__error" role="alert">
                  {roomSession.chatError}
                </p>
              )}
            </section>
          </div>
        )}
      </section>

      <FeedbackPanel
        error={feedbackError}
        includeMetadata={includeFeedbackMetadata}
        message={feedbackMessage}
        onIncludeMetadataChange={setIncludeFeedbackMetadata}
        onMessageChange={setFeedbackMessage}
        onOutcomeChange={handleFeedbackOutcomeChange}
        onReasonChange={setFeedbackReason}
        onSubmit={handleSubmitFeedback}
        outcome={feedbackOutcome}
        reason={feedbackReason}
        receipt={feedbackReceipt}
        status={feedbackStatus}
      />

      <section className="system-panel" aria-labelledby="system-title">
        <div className="system-panel__heading">
          <div>
            <p className="eyebrow">Состояние системы</p>
            <h2 id="system-title">Связь с backend</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={() => void refetch()}
            disabled={isPending}
            aria-label="Обновить состояние"
            title="Обновить состояние"
          >
            <RefreshCw size={18} aria-hidden="true" />
          </button>
        </div>

        {isError ? (
          <div className="system-message system-message--error">
            <WifiOff size={22} aria-hidden="true" />
            <div>
              <strong>Нет соединения</strong>
              <span>Проверьте, что backend запущен на порту 8080.</span>
            </div>
          </div>
        ) : (
          <dl className="system-details" aria-busy={isPending}>
            <div>
              <dt>
                <CircleCheck size={18} aria-hidden="true" />
                Статус
              </dt>
              <dd>{isPending ? "Проверка…" : health.data?.status}</dd>
            </div>
            <div>
              <dt>
                <Server size={18} aria-hidden="true" />
                API
              </dt>
              <dd>{isPending ? "—" : version.data?.apiVersion}</dd>
            </div>
            <div>
              <dt>Версия</dt>
              <dd>{isPending ? "—" : version.data?.version}</dd>
            </div>
            <div>
              <dt>Проверено</dt>
              <dd>{isPending ? "—" : formatCheckedAt(health.data?.checkedAt)}</dd>
            </div>
          </dl>
        )}
      </section>
    </div>
  );
}

function UserErrorBanner({
  error,
  onAction,
  onDismiss,
}: {
  error: RoomUserError;
  onAction: (action: RoomUserErrorAction) => void;
  onDismiss: () => void;
}) {
  const meta = formatUserErrorMeta(error);
  const action = error.action;

  return (
    <div className="system-message system-message--error system-message--actionable" role="alert">
      <AlertTriangle size={22} aria-hidden="true" />
      <div>
        <strong>{error.title}</strong>
        <span>{error.message}</span>
        {meta && <span className="system-message__meta">{meta}</span>}
        <div className="system-message__actions">
          {action && (
            <button className="button" type="button" onClick={() => onAction(action)}>
              <RefreshCw size={16} aria-hidden="true" />
              {formatUserErrorAction(action)}
            </button>
          )}
          <button
            className="icon-button"
            type="button"
            aria-label="Скрыть ошибку"
            title="Скрыть"
            onClick={onDismiss}
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

function FeedbackPanel({
  error,
  includeMetadata,
  message,
  onIncludeMetadataChange,
  onMessageChange,
  onOutcomeChange,
  onReasonChange,
  onSubmit,
  outcome,
  reason,
  receipt,
  status,
}: {
  error: string | null;
  includeMetadata: boolean;
  message: string;
  onIncludeMetadataChange: (value: boolean) => void;
  onMessageChange: (value: string) => void;
  onOutcomeChange: (value: FeedbackOutcome) => void;
  onReasonChange: (value: FeedbackReason) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  outcome: FeedbackOutcome;
  reason: FeedbackReason;
  receipt: FeedbackResponse | null;
  status: FeedbackSubmitStatus;
}) {
  return (
    <section className="feedback-panel" aria-labelledby="feedback-title">
      <div className="feedback-panel__heading">
        <div>
          <p className="eyebrow">Beta</p>
          <h2 id="feedback-title">Обратная связь</h2>
        </div>
        {receipt && (
          <span className="feedback-panel__receipt">ID {receipt.feedbackId.slice(0, 8)}</span>
        )}
      </div>

      <form className="feedback-form" onSubmit={onSubmit}>
        <div className="feedback-form__grid">
          <label className="feedback-field" htmlFor="feedback-outcome">
            <span>Итог</span>
            <select
              id="feedback-outcome"
              aria-label="Итог сессии"
              value={outcome}
              onChange={(event) => onOutcomeChange(event.currentTarget.value as FeedbackOutcome)}
            >
              {FEEDBACK_OUTCOME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="feedback-field" htmlFor="feedback-reason">
            <span>Причина</span>
            <select
              id="feedback-reason"
              aria-label="Причина отзыва"
              value={reason}
              onChange={(event) => onReasonChange(event.currentTarget.value as FeedbackReason)}
            >
              {FEEDBACK_REASON_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="feedback-field" htmlFor="feedback-message">
          <span>Комментарий</span>
          <textarea
            id="feedback-message"
            aria-label="Комментарий к beta"
            maxLength={2000}
            onChange={(event) => onMessageChange(event.currentTarget.value)}
            rows={4}
            value={message}
          />
        </label>

        <div className="feedback-form__actions">
          <label className="feedback-checkbox">
            <input
              type="checkbox"
              checked={includeMetadata}
              onChange={(event) => onIncludeMetadataChange(event.currentTarget.checked)}
            />
            <span>Технические данные</span>
          </label>

          <button className="button button--primary" type="submit" disabled={status === "sending"}>
            <Send size={16} aria-hidden="true" />
            {status === "sending" ? "Отправляем…" : "Отправить отзыв"}
          </button>
        </div>

        {status === "sent" && receipt && (
          <p className="feedback-form__status" role="status">
            Отзыв отправлен · ID {receipt.feedbackId.slice(0, 8)}
          </p>
        )}

        {status === "error" && error && (
          <p className="feedback-form__error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

function ParticipantListItem({ participant }: { participant: Participant }) {
  return (
    <li className="participant-row">
      <span className="participant-row__avatar" aria-hidden="true">
        {getInitials(participant.displayName)}
      </span>
      <div>
        <strong>{participant.displayName}</strong>
        <span>
          {formatParticipantRole(participant.role)} · {formatCheckedAt(participant.joinedAt)}
        </span>
      </div>
      <span
        className={`participant-row__state ${
          participant.online ? "participant-row__state--online" : ""
        }`}
      >
        {participant.online ? "online" : "offline"}
      </span>
    </li>
  );
}

function formatUserErrorAction(action: RoomUserErrorAction) {
  const labels: Record<RoomUserErrorAction, string> = {
    "retry-livekit": "Повторить LiveKit",
    "retry-room-action": "Повторить",
    "retry-websocket": "Переподключить",
  };

  return labels[action];
}

function getNetworkInformation() {
  const nav = navigator as NavigatorWithNetworkInformation;
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
}

function normalizeUuid(value: string | undefined) {
  if (
    !value ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    return undefined;
  }

  return value;
}

function formatFeedbackSubmitError(error: unknown) {
  if (error instanceof ApiProblemError) {
    return (
      error.problem.detail ?? error.problem.title ?? `Backend вернул HTTP ${error.problem.status}`
    );
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Не удалось отправить отзыв.";
}

function formatUserErrorMeta(error: RoomUserError) {
  const values = [
    error.status ? `HTTP ${error.status}` : null,
    error.code ? `Код ${error.code}` : null,
    error.correlationId ? `ID ${error.correlationId}` : null,
  ].filter(Boolean);

  return values.length > 0 ? values.join(" · ") : null;
}

function formatRoomStatus(status: RoomSnapshot["status"]) {
  const labels: Record<RoomSnapshot["status"], string> = {
    CLOSED: "Закрыта",
    CREATED: "Создана",
    EXPIRED: "Истекла",
    HOST_DISCONNECTED: "Host offline",
    PAUSED: "Пауза",
    PLAYING: "Просмотр",
    READY: "Готова",
    WAITING_FOR_HOST: "Ждёт host",
  };

  return labels[status];
}

function formatParticipantRole(role: Participant["role"]) {
  return role === "HOST" ? "Host" : "Guest";
}

function formatConnectionStatus(status: RoomConnectionStatus) {
  const labels: Record<RoomConnectionStatus, string> = {
    closed: "закрыто",
    connecting: "подключение",
    error: "ошибка",
    idle: "нет соединения",
    open: "live",
    reconnecting: "переподключение",
  };

  return labels[status];
}

function formatLiveKitStatus(status: LiveKitConnectionStatus) {
  const labels: Record<LiveKitConnectionStatus, string> = {
    connected: "подключён",
    connecting: "подключение",
    disconnected: "отключён",
    error: "ошибка",
    idle: "ожидает",
    reconnecting: "переподключение",
  };

  return labels[status];
}

function getQualityDisplayStatus(
  liveKitStatus: LiveKitConnectionStatus,
  status: QualityIndicatorsState["status"],
): QualityDisplayStatus {
  if (liveKitStatus === "connecting" || liveKitStatus === "reconnecting") {
    return "reconnecting";
  }

  if (liveKitStatus === "idle" || liveKitStatus === "disconnected") {
    return "idle";
  }

  return status;
}

function formatQualityStatus(status: QualityDisplayStatus) {
  const labels: Record<QualityDisplayStatus, string> = {
    checking: "Проверка",
    good: "Стабильно",
    idle: "Нет данных",
    lost: "Потеряно",
    poor: "Плохая связь",
    reconnecting: "Переподключение",
    warning: "Нестабильно",
  };

  return labels[status];
}

function formatQualityHint(
  status: QualityDisplayStatus,
  liveKitStatus: LiveKitConnectionStatus,
  warning: string | null,
) {
  if (warning) {
    return warning;
  }

  if (liveKitStatus === "connecting") {
    return "LiveKit подключается, показатели скоро появятся.";
  }

  if (liveKitStatus === "reconnecting") {
    return "LiveKit переподключается, возможны паузы в видео или голосе.";
  }

  const labels: Record<QualityDisplayStatus, string> = {
    checking: "Собираем локальные показатели RTC без отправки наружу.",
    good: "Соединение выглядит стабильным.",
    idle: "Показатели появятся после подключения LiveKit.",
    lost: "LiveKit потерял соединение с участником.",
    poor: "Качество заметно просело.",
    reconnecting: "LiveKit переподключается.",
    warning: "Есть признаки нестабильной сети.",
  };

  return labels[status];
}

function formatBitrate(value: number | null) {
  if (value === null) {
    return "—";
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)} Mbps`;
  }

  return `${Math.round(value)} kbps`;
}

function formatMetricMs(value: number | null) {
  return value === null ? "—" : `${Math.round(value)} ms`;
}

function formatPacketLoss(value: number | null) {
  return value === null ? "—" : `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function getWorstJitter(qualityIndicators: QualityIndicatorsState) {
  return maxNullableMetric(qualityIndicators.upload.jitterMs, qualityIndicators.download.jitterMs);
}

function getWorstPacketLoss(qualityIndicators: QualityIndicatorsState) {
  return maxNullableMetric(
    qualityIndicators.upload.packetLossPercent,
    qualityIndicators.download.packetLossPercent,
  );
}

function formatQualityResolution(qualityIndicators: QualityIndicatorsState) {
  const frameWidth = Math.max(
    qualityIndicators.upload.frameWidth ?? 0,
    qualityIndicators.download.frameWidth ?? 0,
  );
  const frameHeight = Math.max(
    qualityIndicators.upload.frameHeight ?? 0,
    qualityIndicators.download.frameHeight ?? 0,
  );
  const fps = Math.max(
    qualityIndicators.upload.framesPerSecond ?? 0,
    qualityIndicators.download.framesPerSecond ?? 0,
  );

  if (!frameWidth || !frameHeight) {
    return "—";
  }

  return fps
    ? `${frameWidth}×${frameHeight} · ${Math.round(fps)} fps`
    : `${frameWidth}×${frameHeight}`;
}

function maxNullableMetric(first: number | null, second: number | null) {
  if (first === null) {
    return second;
  }

  if (second === null) {
    return first;
  }

  return Math.max(first, second);
}

function formatFilePublicationStatus(status: FilePublicationStatus, trackCount: number) {
  const labels: Record<FilePublicationStatus, string> = {
    error: "Ошибка",
    idle: "Не опубликовано",
    live: `Live · ${formatTrackCount(trackCount)}`,
    publishing: "Публикация",
  };

  return labels[status];
}

function toHostWatchPlaybackStatus(status: FilePublicationStatus): RemotePlaybackStatus {
  const statuses: Record<FilePublicationStatus, RemotePlaybackStatus> = {
    error: "error",
    idle: "idle",
    live: "receiving",
    publishing: "waiting",
  };

  return statuses[status];
}

function formatHostWatchPlaybackStatus(status: FilePublicationStatus) {
  const labels: Record<FilePublicationStatus, string> = {
    error: "Ошибка",
    idle: "Нет потока",
    live: "Совместный просмотр",
    publishing: "Публикация",
  };

  return labels[status];
}

function formatHostWatchPlaybackHint(status: FilePublicationStatus) {
  const labels: Record<FilePublicationStatus, string> = {
    error: "Не удалось подготовить локальный просмотр.",
    idle: "Видео ещё не опубликовано.",
    live: "Видео опубликовано.",
    publishing: "Готовим локальный экран и дорожки LiveKit.",
  };

  return labels[status];
}

function formatRemotePlaybackStatus(status: RemotePlaybackStatus) {
  const labels: Record<RemotePlaybackStatus, string> = {
    error: "Ошибка",
    idle: "Нет потока",
    lost: "Поток потерян",
    receiving: "Получаем видео",
    waiting: "Ждём host",
  };

  return labels[status];
}

function formatRemotePlaybackHint(status: RemotePlaybackStatus) {
  const labels: Record<RemotePlaybackStatus, string> = {
    error: "Не удалось воспроизвести поток.",
    idle: "LiveKit подключается.",
    lost: "Host остановил публикацию или отключился.",
    receiving: "",
    waiting: "Host ещё не опубликовал видео.",
  };

  return labels[status];
}

function formatVoiceStatus(status: VoiceChatStatus) {
  const labels: Record<VoiceChatStatus, string> = {
    error: "Ошибка",
    idle: "Микрофон выключен",
    live: "Голос включён",
    muted: "Без звука",
    requesting: "Запрос микрофона",
  };

  return labels[status];
}

function formatVoiceRemoteCount(count: number) {
  if (count === 0) {
    return "Собеседников не слышно";
  }
  if (count === 1) {
    return "1 голосовая дорожка";
  }
  return `${count} голосовые дорожки`;
}

function formatPlaybackSyncStatus(status: PlaybackStatus) {
  const labels: Record<PlaybackStatus, string> = {
    ended: "Завершено",
    idle: "Нет состояния",
    paused: "Пауза",
    playing: "Воспроизведение",
    ready: "Готов",
  };

  return labels[status];
}

function formatPlaybackSyncTime(currentTime: number, duration: number | null) {
  const current = formatDurationMs(currentTime * 1000);

  if (duration === null || duration === 0) {
    return current;
  }

  return `${current} / ${formatDurationMs(duration * 1000)}`;
}

function formatTrackCount(count: number) {
  if (count === 1) {
    return "1 дорожка";
  }

  if (count > 1 && count < 5) {
    return `${count} дорожки`;
  }

  return `${count} дорожек`;
}

function formatShortRoomId(roomId: string) {
  return `${roomId.slice(0, 6)}…${roomId.slice(-4)}`;
}

function getInitials(displayName: string) {
  return displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function formatDurationMs(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
