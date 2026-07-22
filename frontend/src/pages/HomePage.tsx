import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import QRCode from "qrcode";
import {
  Activity,
  AlertTriangle,
  Check,
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
  QrCode,
  Radio,
  RefreshCw,
  Send,
  Server,
  Share2,
  Square,
  Users,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import {
  type FeedbackClientMetadata,
  type FeedbackOutcome,
  type FeedbackReason,
  type FeedbackResponse,
  submitFeedback,
} from "../features/feedback/feedback-api";
import { ApiProblemError, type Participant, type RoomSnapshot } from "../features/rooms/room-api";
import { copyText } from "../features/rooms/copy-text";
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
import {
  INVITE_SHARE_TEXT,
  INVITE_SHARE_TITLE,
  createRoomInviteUrl,
  isLoopbackRoomInviteUrl,
  toPublicRoomInviteUrl,
  toTelegramShareUrl,
} from "../features/rooms/share-invite";
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
type InviteShareStatus = "idle" | "copied" | "shared" | "error";

type NavigatorWithWebShare = Navigator & {
  share?: (data: { text?: string; title?: string; url?: string }) => Promise<void>;
};

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

const STAGE_CONTROLS_HIDE_DELAY_MS = 2_600;

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
  const navigate = useNavigate();
  const isMobileInviteHandoff = useMobileInviteHandoff(Boolean(routeRoomId));
  const { health, version, isPending, isError, refetch } = useSystemStatus();
  const roomSession = useRoomSession(isMobileInviteHandoff ? undefined : routeRoomId);
  const { setHostPreviewElement, setRemotePlaybackElements } = roomSession;
  const [hostDisplayName, setHostDisplayName] = useState("Host");
  const [guestDisplayName, setGuestDisplayName] = useState("Guest");
  const [joinRoomIdDraft, setJoinRoomIdDraft] = useState("");
  const [isFileDropActive, setIsFileDropActive] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [isInviteShareSheetOpen, setIsInviteShareSheetOpen] = useState(false);
  const [inviteShareStatus, setInviteShareStatus] = useState<InviteShareStatus>("idle");
  const [inviteQrSvg, setInviteQrSvg] = useState<string | null>(null);
  const [inviteQrError, setInviteQrError] = useState(false);
  const [roomIdCopied, setRoomIdCopied] = useState(false);
  const [seekBarValue, setSeekBarValue] = useState<number | null>(null);
  const [playbackMuted, setPlaybackMuted] = useState(false);
  const [playbackVolume, setPlaybackVolume] = useState(100);
  const [areStageControlsVisible, setAreStageControlsVisible] = useState(true);
  const [chatDraft, setChatDraft] = useState("");
  const [feedbackOutcome, setFeedbackOutcome] = useState<FeedbackOutcome>("WORKED");
  const [feedbackReason, setFeedbackReason] = useState<FeedbackReason>("SUCCESS");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [includeFeedbackMetadata, setIncludeFeedbackMetadata] = useState(true);
  const [feedbackStatus, setFeedbackStatus] = useState<FeedbackSubmitStatus>("idle");
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackReceipt, setFeedbackReceipt] = useState<FeedbackResponse | null>(null);
  const isUnavailableInviteRoute = Boolean(
    routeRoomId && roomSession.userError?.area === "room" && roomSession.userError.status === 404,
  );
  const joinRoomId = isUnavailableInviteRoute ? "" : joinRoomIdDraft || routeRoomId || "";
  const isOnline = !isPending && !isError;
  const room = roomSession.room;
  const participant = roomSession.participant;
  const publicInviteUrl = toPublicRoomInviteUrl(roomSession.inviteUrl);
  const isLoopbackInvite = isLoopbackRoomInviteUrl(publicInviteUrl);
  const telegramShareUrl = toTelegramShareUrl(publicInviteUrl);
  const mobileInviteUrl = routeRoomId ? createRoomInviteUrl(routeRoomId) : null;
  const canUseNativeShare = typeof (navigator as NavigatorWithWebShare).share === "function";
  const roomClosed = room?.status === "CLOSED" || room?.status === "EXPIRED";
  const isHost = participant?.role === "HOST";

  useEffect(() => {
    if (isUnavailableInviteRoute) {
      navigate("/", { replace: true });
    }
  }, [isUnavailableInviteRoute, navigate]);
  const mediaRecoveryRequester = roomSession.mediaRecoveryAlert
    ? (room?.participants.find(
        (item) => item.participantId === roomSession.mediaRecoveryAlert?.participantIdentity,
      )?.displayName ?? "Гость")
    : null;
  const mediaRecoveryGuestStatus = isHost
    ? null
    : formatMediaRecoveryGuestStatus(
        roomSession.mediaRecoveryRequestStatus,
        roomSession.mediaRecoveryRequestError,
        roomSession.mediaRecoveryHostStatus,
      );
  const isMediaRecoveryGuestError =
    roomSession.mediaRecoveryRequestStatus === "error" ||
    roomSession.mediaRecoveryHostStatus === "failed" ||
    roomSession.mediaRecoveryHostStatus === "timed_out";
  const isRoomActionPending = roomSession.pendingAction !== null;
  const isFilePublishing =
    roomSession.filePublicationStatus === "publishing" ||
    roomSession.filePublicationStatus === "restarting";
  const canPublishFile =
    roomSession.fileStatus === "ready" &&
    roomSession.liveKitStatus === "connected" &&
    !isFilePublishing;
  const canStopFilePublication =
    roomSession.filePublicationStatus === "publishing" ||
    roomSession.filePublicationStatus === "restarting" ||
    roomSession.filePublicationStatus === "live";
  const canUseVoice = roomSession.liveKitStatus === "connected" && !roomClosed;
  const voiceRequiresSecureContext = globalThis.isSecureContext === false;
  const visibleVoiceError = voiceRequiresSecureContext
    ? roomSession.voiceRemoteError
    : (roomSession.voiceError ?? roomSession.voiceRemoteError);
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
  const hasPlaybackAudio = isHost
    ? roomSession.filePublicationTrackCount > 1
    : roomSession.remotePlaybackAudioTrackName !== null;
  const isPlaybackSoundMuted = playbackMuted || playbackVolume === 0;
  const shouldAutoHideStageControls =
    showWatchSurface &&
    (isHost
      ? roomSession.hostPlaybackStatus === "playing"
      : roomSession.remotePlaybackStatus === "receiving" &&
        roomSession.playbackSyncStatus === "playing");
  const isStageControlsShown = !shouldAutoHideStageControls || areStageControlsVisible;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hostPreviewVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const watchPlayerRef = useRef<HTMLDivElement>(null);
  const stageControlsHideTimerRef = useRef<number | null>(null);
  const stageControlsPointerInsideRef = useRef(false);
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
    const mediaElement = isHost ? hostPreviewVideoRef.current : remoteAudioRef.current;
    if (!mediaElement) {
      return;
    }

    mediaElement.muted = isPlaybackSoundMuted;
    mediaElement.volume = playbackVolume / 100;
  }, [
    isHost,
    isPlaybackSoundMuted,
    playbackVolume,
    room?.roomId,
    roomSession.remotePlaybackAudioTrackName,
    showWatchSurface,
  ]);

  useEffect(() => {
    const node = chatEndRef.current;
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "nearest" });
    }
  }, [chatMessageCount]);

  useEffect(() => {
    if (!shouldAutoHideStageControls) {
      if (stageControlsHideTimerRef.current !== null) {
        window.clearTimeout(stageControlsHideTimerRef.current);
        stageControlsHideTimerRef.current = null;
      }
      return undefined;
    }

    const showTimer = window.setTimeout(() => {
      setAreStageControlsVisible(true);
    }, 0);
    stageControlsHideTimerRef.current = window.setTimeout(() => {
      if (!stageControlsPointerInsideRef.current) {
        setAreStageControlsVisible(false);
      }
    }, STAGE_CONTROLS_HIDE_DELAY_MS);

    return () => {
      window.clearTimeout(showTimer);
      if (stageControlsHideTimerRef.current !== null) {
        window.clearTimeout(stageControlsHideTimerRef.current);
        stageControlsHideTimerRef.current = null;
      }
    };
  }, [shouldAutoHideStageControls]);

  const applyPlaybackAudioSettings = (muted: boolean, volume: number) => {
    const mediaElement = isHost ? hostPreviewVideoRef.current : remoteAudioRef.current;
    if (!mediaElement) {
      return;
    }

    mediaElement.muted = muted || volume === 0;
    mediaElement.volume = volume / 100;
  };

  const handlePlaybackVolumeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const volume = Number(event.target.value);
    const muted = volume === 0;
    setPlaybackMuted(muted);
    setPlaybackVolume(volume);
    applyPlaybackAudioSettings(muted, volume);

    if (!muted && !isHost) {
      void roomSession.resumeRemotePlaybackAudio();
    }
  };

  const handlePlaybackSoundToggle = () => {
    const muted = !isPlaybackSoundMuted;
    const volume = muted ? playbackVolume : Math.max(playbackVolume, 50);
    setPlaybackMuted(muted);
    setPlaybackVolume(volume);
    applyPlaybackAudioSettings(muted, volume);

    if (!muted && !isHost) {
      void roomSession.resumeRemotePlaybackAudio();
    }
  };

  function revealStageControls() {
    setAreStageControlsVisible(true);

    if (stageControlsHideTimerRef.current !== null) {
      window.clearTimeout(stageControlsHideTimerRef.current);
      stageControlsHideTimerRef.current = null;
    }

    if (!shouldAutoHideStageControls || stageControlsPointerInsideRef.current) {
      return;
    }

    stageControlsHideTimerRef.current = window.setTimeout(() => {
      if (!stageControlsPointerInsideRef.current) {
        setAreStageControlsVisible(false);
      }
    }, STAGE_CONTROLS_HIDE_DELAY_MS);
  }

  function handleStageControlsPointerEnter() {
    stageControlsPointerInsideRef.current = true;
    revealStageControls();
  }

  function handleStageControlsPointerLeave() {
    stageControlsPointerInsideRef.current = false;
    revealStageControls();
  }

  function commitHostSeek(seconds: number) {
    roomSession.hostSeek(seconds, () => setSeekBarValue(null));
  }

  function handleSeekBarKeyUp(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (
      ![
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "End",
        "Home",
        "PageDown",
        "PageUp",
      ].includes(event.key)
    ) {
      return;
    }

    commitHostSeek(Number(event.currentTarget.value));
  }

  useEffect(() => {
    let cancelled = false;

    if (!isInviteShareSheetOpen || !publicInviteUrl) {
      return undefined;
    }

    void QRCode.toString(publicInviteUrl, {
      color: { dark: "#f6f1ff", light: "#15111f" },
      errorCorrectionLevel: "M",
      margin: 1,
      type: "svg",
      width: 232,
    })
      .then((svg) => {
        if (!cancelled) {
          setInviteQrSvg(svg);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setInviteQrError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isInviteShareSheetOpen, publicInviteUrl]);

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
    if (!publicInviteUrl) {
      return false;
    }

    try {
      await copyText(publicInviteUrl);
      setInviteCopied(true);
      setInviteShareStatus("copied");
      window.setTimeout(() => setInviteCopied(false), 1800);
      return true;
    } catch {
      setInviteShareStatus("error");
      return false;
    }
  }

  async function handleNativeInviteShare() {
    if (!publicInviteUrl) {
      return;
    }

    const nativeShare = (navigator as NavigatorWithWebShare).share;
    if (!nativeShare) {
      await handleCopyInvite();
      return;
    }

    try {
      await nativeShare({
        text: INVITE_SHARE_TEXT,
        title: INVITE_SHARE_TITLE,
        url: publicInviteUrl,
      });
      setInviteShareStatus("shared");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      await handleCopyInvite();
    }
  }

  async function handleCopyRoomId() {
    if (!room) {
      return;
    }

    try {
      await copyText(room.roomId);
      setRoomIdCopied(true);
      window.setTimeout(() => setRoomIdCopied(false), 1800);
    } catch {
      // The field remains visible, so a person can still select and copy the ID manually.
    }
  }

  if (isMobileInviteHandoff && mobileInviteUrl) {
    return <MobileInviteHandoff inviteUrl={mobileInviteUrl} />;
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
            <div className="room-workspace__actions">
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
              {publicInviteUrl && (
                <button
                  className="button room-share-trigger"
                  onClick={() => {
                    setInviteShareStatus("idle");
                    setInviteQrSvg(null);
                    setInviteQrError(false);
                    setIsInviteShareSheetOpen(true);
                  }}
                  type="button"
                >
                  <Share2 size={17} aria-hidden="true" />
                  Пригласить
                </button>
              )}
            </div>
          )}
        </div>

        {isInviteShareSheetOpen && publicInviteUrl && (
          <InviteShareSheet
            canUseNativeShare={canUseNativeShare}
            inviteUrl={publicInviteUrl}
            onClose={() => setIsInviteShareSheetOpen(false)}
            onCopy={() => void handleCopyInvite()}
            onNativeShare={() => void handleNativeInviteShare()}
            qrError={inviteQrError}
            qrSvg={inviteQrSvg}
            shareStatus={inviteShareStatus}
            telegramShareUrl={telegramShareUrl}
          />
        )}

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
                      {roomSession.fileResult.compatibility === "experimental" && (
                        <span className="file-picker__experimental">
                          Формат не входит в базовую гарантию: результат зависит от этого
                          устройства.
                        </span>
                      )}
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
                        commitHostSeek(Number((e.target as HTMLInputElement).value));
                      }}
                      onPointerCancel={() => {
                        setSeekBarValue(null);
                      }}
                      onKeyUp={handleSeekBarKeyUp}
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

                <div
                  className="remote-player"
                  ref={watchPlayerRef}
                  onPointerDown={revealStageControls}
                  onPointerMove={revealStageControls}
                >
                  {isHost ? (
                    <video
                      ref={hostPreviewVideoRef}
                      className="remote-player__video"
                      autoPlay
                      muted={isPlaybackSoundMuted}
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
                      <audio ref={remoteAudioRef} autoPlay muted={isPlaybackSoundMuted} />
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

                  {isHost && roomSession.mediaRecoveryAlert && (
                    <div className="remote-player__recovery-alert" role="status">
                      <AlertTriangle size={18} aria-hidden="true" />
                      <span>{mediaRecoveryRequester} сообщает: видео зависло</span>
                      <button
                        className="button button--primary remote-player__recovery-action"
                        type="button"
                        onClick={() => void roomSession.restartFilePublication()}
                      >
                        <RefreshCw size={16} aria-hidden="true" />
                        Восстановить
                      </button>
                    </div>
                  )}

                  <div
                    className={`remote-player__stage-controls${
                      isStageControlsShown ? "" : " remote-player__stage-controls--hidden"
                    }`}
                    onFocusCapture={revealStageControls}
                    onPointerEnter={handleStageControlsPointerEnter}
                    onPointerLeave={handleStageControlsPointerLeave}
                  >
                    <div className="remote-player__sound-controls" aria-label="Звук просмотра">
                      <button
                        className="remote-player__sound-toggle"
                        type="button"
                        disabled={!hasPlaybackAudio}
                        onClick={handlePlaybackSoundToggle}
                        aria-label={
                          !hasPlaybackAudio
                            ? "В файле нет аудиодорожки"
                            : isPlaybackSoundMuted
                              ? "Включить звук"
                              : "Выключить звук"
                        }
                        title={!hasPlaybackAudio ? "В файле нет аудиодорожки" : undefined}
                      >
                        {isPlaybackSoundMuted ? (
                          <VolumeX size={18} aria-hidden="true" />
                        ) : (
                          <Volume2 size={18} aria-hidden="true" />
                        )}
                      </button>
                      <input
                        className="remote-player__volume"
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={playbackVolume}
                        disabled={!hasPlaybackAudio}
                        onChange={handlePlaybackVolumeChange}
                        aria-label="Громкость просмотра"
                      />
                      <output aria-live="polite">{playbackVolume}%</output>
                    </div>

                    <div className="remote-player__stage-actions">
                      {!isHost && roomSession.liveKitStatus === "connected" && (
                        <button
                          className="icon-button remote-player__recovery-request"
                          type="button"
                          disabled={
                            roomSession.mediaRecoveryRequestStatus === "sending" ||
                            roomSession.mediaRecoveryRequestStatus === "sent"
                          }
                          aria-label={
                            roomSession.mediaRecoveryRequestStatus === "sent"
                              ? "Host уведомлён о проблеме с видео"
                              : "Сообщить host, что видео зависло"
                          }
                          title={
                            roomSession.mediaRecoveryRequestStatus === "sent"
                              ? "Host уведомлён"
                              : "Видео зависло"
                          }
                          onClick={() => void roomSession.requestMediaRecovery()}
                        >
                          <AlertTriangle size={18} aria-hidden="true" />
                        </button>
                      )}
                      {isHost && roomSession.filePublicationStatus === "live" && (
                        <button
                          className="icon-button remote-player__restart"
                          type="button"
                          aria-label="Перезапустить трансляцию с текущей позиции"
                          title="Восстановить трансляцию"
                          onClick={() => void roomSession.restartFilePublication()}
                        >
                          <RefreshCw size={18} aria-hidden="true" />
                        </button>
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
                  </div>
                  {mediaRecoveryGuestStatus && (
                    <p
                      className={`remote-player__recovery-status${
                        isMediaRecoveryGuestError ? " remote-player__recovery-status--error" : ""
                      }`}
                      role={isMediaRecoveryGuestError ? "alert" : "status"}
                    >
                      {mediaRecoveryGuestStatus}
                    </p>
                  )}
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
                  <span
                    className={`room-pill room-pill--voice-${
                      voiceRequiresSecureContext ? "requires-https" : roomSession.voiceStatus
                    }`}
                  >
                    {roomSession.voiceStatus === "live" ? (
                      <Mic size={15} aria-hidden="true" />
                    ) : (
                      <MicOff size={15} aria-hidden="true" />
                    )}
                    {voiceRequiresSecureContext
                      ? "Нужен HTTPS"
                      : formatVoiceStatus(roomSession.voiceStatus)}
                  </span>
                </div>

                {voiceRequiresSecureContext ? (
                  <p className="voice-secure-context-hint" role="status">
                    Голос появится после запуска через HTTPS. В домашнем LAN-режиме доступны
                    просмотр, чат и приглашения.
                  </p>
                ) : (
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
                )}

                <div className="voice-meta">
                  <span>{formatVoiceRemoteCount(roomSession.voiceRemoteParticipantCount)}</span>
                  {roomSession.voiceRemoteParticipantIdentities.slice(0, 2).map((identity) => (
                    <span key={identity}>{identity}</span>
                  ))}
                </div>

                {visibleVoiceError && (
                  <div className="inline-error" role="alert">
                    <p>{visibleVoiceError}</p>
                    {!voiceRequiresSecureContext && roomSession.voiceError && (
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
                        className={`icon-button room-copy-field__copy${roomIdCopied ? " is-copied" : ""}`}
                        type="button"
                        onClick={() => void handleCopyRoomId()}
                        aria-label={
                          roomIdCopied ? "ID комнаты скопирован" : "Скопировать ID комнаты"
                        }
                        title={roomIdCopied ? "Скопировано" : "Скопировать ID комнаты"}
                      >
                        {roomIdCopied ? (
                          <Check size={17} aria-hidden="true" />
                        ) : (
                          <Copy size={17} aria-hidden="true" />
                        )}
                      </button>
                    </div>

                    {roomSession.inviteUrl && (
                      <div className="room-copy-field">
                        <span aria-label="Ссылка приглашения">
                          <LinkIcon size={15} aria-hidden="true" />
                          Ссылка
                        </span>
                        <a href={roomSession.inviteUrl}>{roomSession.inviteUrl}</a>
                        <button
                          className={`icon-button room-copy-field__copy${inviteCopied ? " is-copied" : ""}`}
                          type="button"
                          onClick={() => void handleCopyInvite()}
                          aria-label={
                            inviteCopied
                              ? "Ссылка приглашения скопирована"
                              : "Скопировать приглашение"
                          }
                          title={inviteCopied ? "Скопировано" : "Скопировать приглашение"}
                        >
                          {inviteCopied ? (
                            <Check size={17} aria-hidden="true" />
                          ) : (
                            <Copy size={17} aria-hidden="true" />
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                  {isLoopbackInvite && (
                    <p className="room-network-hint" role="status">
                      <Wifi size={16} aria-hidden="true" /> Это приглашение работает только на этом
                      компьютере. Для второго устройства откройте сервис у host по
                      <code>http://&lt;IPv4-host&gt;:8088</code> и создайте новую комнату.
                    </p>
                  )}
                  <p className="visually-hidden" role="status">
                    {roomIdCopied && "ID комнаты скопирован."}
                    {inviteCopied && "Ссылка приглашения скопирована."}
                  </p>

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

function InviteShareSheet({
  canUseNativeShare,
  inviteUrl,
  onClose,
  onCopy,
  onNativeShare,
  qrError,
  qrSvg,
  shareStatus,
  telegramShareUrl,
}: {
  canUseNativeShare: boolean;
  inviteUrl: string;
  onClose: () => void;
  onCopy: () => void;
  onNativeShare: () => void;
  qrError: boolean;
  qrSvg: string | null;
  shareStatus: InviteShareStatus;
  telegramShareUrl: string | null;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="invite-share-sheet__backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-labelledby="invite-share-title"
        aria-modal="true"
        className="invite-share-sheet"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="invite-share-sheet__heading">
          <div>
            <p className="eyebrow">Приглашение</p>
            <h2 id="invite-share-title">Позовите в комнату</h2>
          </div>
          <button
            aria-label="Закрыть приглашение"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="invite-share-sheet__content">
          <div className="invite-share-sheet__qr" role="img" aria-label="QR-код приглашения">
            {qrSvg ? (
              // The SVG comes only from qrcode and encodes the canonical public room route above.
              <div dangerouslySetInnerHTML={{ __html: qrSvg }} />
            ) : qrError ? (
              <span>Не удалось подготовить QR-код.</span>
            ) : (
              <span>Готовим QR-код…</span>
            )}
          </div>

          <div className="invite-share-sheet__copy">
            <p>Отсканируйте код или отправьте ссылку. Просмотр поддерживается на компьютере.</p>
            <code>{inviteUrl}</code>
            <div className="invite-share-sheet__actions">
              <button
                className={`button button--primary invite-share-sheet__copy-button${
                  shareStatus === "copied" ? " is-copied" : ""
                }`}
                onClick={onCopy}
                type="button"
              >
                {shareStatus === "copied" ? (
                  <Check size={17} aria-hidden="true" />
                ) : (
                  <Copy size={17} aria-hidden="true" />
                )}
                {shareStatus === "copied" ? "Скопировано" : "Скопировать ссылку"}
              </button>
              <button className="button" onClick={onNativeShare} type="button">
                <Share2 size={17} aria-hidden="true" />
                {canUseNativeShare ? "Поделиться через устройство" : "Скопировать как fallback"}
              </button>
              {telegramShareUrl && (
                <a
                  className="button invite-share-sheet__telegram"
                  href={telegramShareUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  <Send size={17} aria-hidden="true" />
                  Telegram
                </a>
              )}
            </div>
            {shareStatus !== "idle" && (
              <p
                className={`invite-share-sheet__status invite-share-sheet__status--${shareStatus}`}
                role="status"
              >
                {shareStatus === "copied" && "Ссылка скопирована."}
                {shareStatus === "shared" && "Системное меню отправки открыто."}
                {shareStatus === "error" && "Не удалось скопировать ссылку. Скопируйте её вручную."}
              </p>
            )}
          </div>
        </div>

        <p className="invite-share-sheet__privacy">
          <QrCode size={15} aria-hidden="true" />В приглашение входит только публичная ссылка
          комнаты — без токенов, названия видео и данных сессии.
        </p>
      </section>
    </div>
  );
}

function MobileInviteHandoff({ inviteUrl }: { inviteUrl: string }) {
  const [status, setStatus] = useState<InviteShareStatus>("idle");
  const telegramShareUrl = toTelegramShareUrl(inviteUrl);
  const nativeShare = (navigator as NavigatorWithWebShare).share;

  async function copyInvite() {
    try {
      await copyText(inviteUrl);
      setStatus("copied");
      window.setTimeout(() => setStatus("idle"), 1800);
    } catch {
      setStatus("error");
    }
  }

  async function shareInvite() {
    if (!nativeShare) {
      await copyInvite();
      return;
    }

    try {
      await nativeShare({ text: INVITE_SHARE_TEXT, title: INVITE_SHARE_TITLE, url: inviteUrl });
      setStatus("shared");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        await copyInvite();
      }
    }
  }

  return (
    <main className="mobile-invite-handoff">
      <section className="mobile-invite-handoff__card" aria-labelledby="mobile-invite-title">
        <span className="mobile-invite-handoff__icon" aria-hidden="true">
          <MonitorPlay size={28} />
        </span>
        <p className="eyebrow">Приглашение в приватную комнату</p>
        <h1 id="mobile-invite-title">Откройте просмотр на компьютере</h1>
        <p>
          Эта beta поддерживает совместное видео в Chrome или Edge на desktop. Отправьте приглашение
          себе и откройте его на компьютере.
        </p>
        <code>{inviteUrl}</code>
        <div className="mobile-invite-handoff__actions">
          <button
            className={`button button--primary mobile-invite-handoff__copy-button${
              status === "copied" ? " is-copied" : ""
            }`}
            onClick={() => void copyInvite()}
            type="button"
          >
            {status === "copied" ? (
              <Check size={17} aria-hidden="true" />
            ) : (
              <Copy size={17} aria-hidden="true" />
            )}
            {status === "copied" ? "Скопировано" : "Скопировать ссылку"}
          </button>
          <button className="button" onClick={() => void shareInvite()} type="button">
            <Share2 size={17} aria-hidden="true" />
            Отправить себе
          </button>
          {telegramShareUrl && (
            <a className="button" href={telegramShareUrl} rel="noreferrer" target="_blank">
              <Send size={17} aria-hidden="true" />
              Telegram
            </a>
          )}
        </div>
        {status !== "idle" && (
          <p className="mobile-invite-handoff__status" role="status">
            {status === "copied" && "Ссылка скопирована."}
            {status === "shared" && "Системное меню отправки открыто."}
            {status === "error" && "Не удалось скопировать ссылку. Скопируйте её вручную."}
          </p>
        )}
      </section>
    </main>
  );
}

function useMobileInviteHandoff(enabled: boolean) {
  const getMatch = () => {
    if (!enabled || typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }

    return (
      window.matchMedia("(max-width: 720px)").matches &&
      window.matchMedia("(pointer: coarse)").matches
    );
  };

  const [, setMediaQueryRevision] = useState(0);

  useEffect(() => {
    if (!enabled || typeof window.matchMedia !== "function") {
      return undefined;
    }

    const narrowViewport = window.matchMedia("(max-width: 720px)");
    const coarsePointer = window.matchMedia("(pointer: coarse)");
    const updateMatch = () => setMediaQueryRevision((current) => current + 1);

    narrowViewport.addEventListener("change", updateMatch);
    coarsePointer.addEventListener("change", updateMatch);

    return () => {
      narrowViewport.removeEventListener("change", updateMatch);
      coarsePointer.removeEventListener("change", updateMatch);
    };
  }, [enabled]);

  return getMatch();
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
    restarting: "Восстановление",
  };

  return labels[status];
}

function toHostWatchPlaybackStatus(status: FilePublicationStatus): RemotePlaybackStatus {
  const statuses: Record<FilePublicationStatus, RemotePlaybackStatus> = {
    error: "error",
    idle: "idle",
    live: "receiving",
    publishing: "waiting",
    restarting: "waiting",
  };

  return statuses[status];
}

function formatHostWatchPlaybackStatus(status: FilePublicationStatus) {
  const labels: Record<FilePublicationStatus, string> = {
    error: "Ошибка",
    idle: "Нет потока",
    live: "Совместный просмотр",
    publishing: "Публикация",
    restarting: "Восстанавливаем показ",
  };

  return labels[status];
}

function formatHostWatchPlaybackHint(status: FilePublicationStatus) {
  const labels: Record<FilePublicationStatus, string> = {
    error: "Не удалось подготовить локальный просмотр.",
    idle: "Видео ещё не опубликовано.",
    live: "Видео опубликовано.",
    publishing: "Готовим локальный экран и дорожки LiveKit.",
    restarting: "Перезапускаем поток с текущей позиции.",
  };

  return labels[status];
}

function formatMediaRecoveryGuestStatus(
  requestStatus: "idle" | "sending" | "sent" | "unanswered" | "error",
  requestError: string | null,
  hostStatus: "idle" | "started" | "succeeded" | "failed" | "timed_out",
) {
  if (hostStatus === "started") {
    return "Host запускает восстановление трансляции…";
  }
  if (hostStatus === "succeeded") {
    return "Host обновил трансляцию. Ждём видео…";
  }
  if (hostStatus === "failed") {
    return "Host пока не смог восстановить трансляцию.";
  }
  if (hostStatus === "timed_out") {
    return "Не получили результат восстановления. Можно отправить сигнал ещё раз.";
  }
  if (requestStatus === "sending") {
    return "Отправляем сигнал host-у…";
  }
  if (requestStatus === "sent") {
    return "Host уведомлён о проблеме с видео.";
  }
  if (requestStatus === "unanswered") {
    return "Host пока не ответил. Можно отправить сигнал ещё раз.";
  }
  if (requestStatus === "error") {
    return requestError ?? "Не удалось отправить сигнал host-у.";
  }
  return null;
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
