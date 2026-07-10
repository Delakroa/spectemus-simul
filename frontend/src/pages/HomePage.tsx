import { type FormEvent, useState } from "react";
import {
  CircleCheck,
  Clapperboard,
  Copy,
  DoorOpen,
  Link as LinkIcon,
  LogIn,
  Plus,
  Power,
  RefreshCw,
  Server,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useParams } from "react-router-dom";

import { type Participant, type RoomSnapshot } from "../features/rooms/room-api";
import { type LiveKitConnectionStatus } from "../features/rooms/livekit-connection";
import { type RoomConnectionStatus, useRoomSession } from "../features/rooms/use-room-session";
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

export function HomePage() {
  const { roomId: routeRoomId } = useParams();
  const { health, version, isPending, isError, refetch } = useSystemStatus();
  const roomSession = useRoomSession(routeRoomId);
  const [hostDisplayName, setHostDisplayName] = useState("Host");
  const [guestDisplayName, setGuestDisplayName] = useState("Guest");
  const [joinRoomIdDraft, setJoinRoomIdDraft] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [roomIdCopied, setRoomIdCopied] = useState(false);
  const joinRoomId = joinRoomIdDraft || routeRoomId || "";
  const isOnline = !isPending && !isError;
  const room = roomSession.room;
  const participant = roomSession.participant;
  const roomClosed = room?.status === "CLOSED" || room?.status === "EXPIRED";
  const isHost = participant?.role === "HOST";
  const isRoomActionPending = roomSession.pendingAction !== null;

  function handleCreateRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void roomSession.create(hostDisplayName);
  }

  function handleJoinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void roomSession.join(joinRoomId, guestDisplayName);
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

        {!room && (
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

        {room && (
          <div className="room-dashboard">
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
