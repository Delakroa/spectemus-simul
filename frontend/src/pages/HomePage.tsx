import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from "react";
import {
  Activity,
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
} from "lucide-react";
import { useParams } from "react-router-dom";

import { type Participant, type RoomSnapshot } from "../features/rooms/room-api";
import { type LiveKitConnectionStatus } from "../features/rooms/livekit-connection";
import {
  type FilePublicationStatus,
  type PlaybackStatus,
  type QualityIndicatorsState,
  type RemotePlaybackStatus,
  type RoomConnectionStatus,
  type VoiceChatStatus,
  useRoomSession,
} from "../features/rooms/use-room-session";
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
  const [inviteCopied, setInviteCopied] = useState(false);
  const [roomIdCopied, setRoomIdCopied] = useState(false);
  const [seekBarValue, setSeekBarValue] = useState<number | null>(null);
  const [chatDraft, setChatDraft] = useState("");
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
    if (file) {
      void roomSession.selectFile(file);
    }
    event.target.value = "";
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

  function handleSendChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (roomSession.sendChatMessage(chatDraft)) {
      setChatDraft("");
    }
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
    <div className="home">
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
            <span className="watch-stage__label">
              {room ? `Комната ${formatShortRoomId(room.roomId)}` : "Сеанс просмотра"}
            </span>
            <span className="watch-stage__state">
              {room ? formatRoomStatus(room.status) : "Не начат"}
            </span>
          </div>

          {room ? (
            <div className="watch-stage__room">
              <span className="watch-stage__icon" aria-hidden="true">
                <Clapperboard size={34} />
              </span>
              <div>
                <strong>{room.media?.displayName ?? "Видео не выбрано"}</strong>
                <span>
                  {participant
                    ? `${participant.displayName} · ${formatParticipantRole(participant.role)}`
                    : "Участник не выбран"}
                </span>
              </div>
              <div className="watch-stage__participants" aria-label="Участники комнаты">
                {room.participants.map((item) => (
                  <span
                    className={`watch-stage__participant ${
                      item.online ? "watch-stage__participant--online" : ""
                    }`}
                    key={item.participantId}
                    title={item.displayName}
                  >
                    {getInitials(item.displayName)}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="watch-stage__empty">
              <span className="watch-stage__icon" aria-hidden="true">
                <Clapperboard size={34} />
              </span>
              <strong>Комната пока не выбрана</strong>
            </div>
          )}

          <div className="watch-stage__timeline" aria-hidden="true">
            <span style={{ width: `${getMediaProgress(room)}%` }} />
          </div>
        </div>
      </section>

      <section className="room-workspace" aria-labelledby="room-workspace-title">
        <div className="room-workspace__heading">
          <div>
            <p className="eyebrow">Комната</p>
            <h2 id="room-workspace-title">Управление сеансом</h2>
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
          <div className="room-dashboard">
            {isHost && !roomClosed && (
              <section
                className="room-card"
                aria-labelledby="file-picker-title"
                style={{ gridColumn: "1 / -1" }}
              >
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
                  accept="video/mp4,video/webm,video/*"
                  aria-hidden="true"
                  style={{ display: "none" }}
                  tabIndex={-1}
                  onChange={handleFileChange}
                />

                <div className="file-picker">
                  <button
                    className="button file-picker__trigger"
                    type="button"
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
                        {formatDurationMs(roomSession.fileResult.durationMs)}
                        {roomSession.fileResult.hasAudio ? " · со звуком" : " · без звука"}
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
                    <p className="file-picker__error" role="alert">
                      {roomSession.filePublicationError}
                    </p>
                  )}

                  {roomSession.fileStatus === "error" && roomSession.fileError && (
                    <p className="file-picker__error" role="alert">
                      {roomSession.fileError}
                    </p>
                  )}
                </div>

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
                style={{ gridColumn: "1 / -1" }}
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
                  <p className="file-picker__error" role="alert">
                    {roomSession.voiceError ?? roomSession.voiceRemoteError}
                  </p>
                )}
              </section>
            )}

            {!roomClosed && (
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
            )}

            <section className="room-card" aria-labelledby="room-details-title">
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

            <section className="room-card" aria-labelledby="participants-title">
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

            <section className="room-card room-card--events" aria-labelledby="events-title">
              <div className="room-card__heading">
                <h3 id="events-title">События</h3>
              </div>

              {roomSession.events.length > 0 ? (
                <ol className="event-list">
                  {roomSession.events.map((event) => (
                    <li key={event.eventId}>
                      <time dateTime={event.occurredAt}>{formatCheckedAt(event.occurredAt)}</time>
                      <span>{event.label}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="room-card__empty">Событий пока нет</p>
              )}
            </section>

            <section
              className="room-card room-card--chat"
              aria-labelledby="chat-title"
              style={{ gridColumn: "1 / -1" }}
            >
              <div className="room-card__heading">
                <h3 id="chat-title">Чат</h3>
                <span className="room-count">
                  <MessageSquare size={16} aria-hidden="true" />
                  {roomSession.chatMessages.length}
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

function getMediaProgress(room: RoomSnapshot | null) {
  if (!room?.media || room.media.durationMs === 0) {
    return 0;
  }

  return Math.min(100, Math.round((room.media.positionMs / room.media.durationMs) * 100));
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
