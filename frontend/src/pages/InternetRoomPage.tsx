import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import type { Room as LiveKitRoom } from "livekit-client";

import {
  getPublicRoom,
  isAccountRequiredError,
  mintPublicLiveKitToken,
  toApiProblemError,
  unwrapDesktopIpcResult,
  type PublicLiveKitTokenResponse,
} from "../features/internet/internet-api";
import {
  formatInternetRemotePlaybackHint,
  formatInternetRemotePlaybackStatus,
  isInternetRemotePlaybackUserActionRequired,
  useInternetGuestRemotePlayback,
} from "../features/internet/use-internet-guest-remote-playback";
import { useInternetHostMediaPublish } from "../features/internet/use-internet-host-media-publish";
import {
  connectLiveKitRoom,
  type LiveKitConnection,
  type LiveKitConnectionStatus,
} from "../features/rooms/livekit-connection";
import { isInternetRoomChoiceEnabled } from "../features/rooms/room-mode";

const PUBLIC_ROOM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type MediaRole = "HOST" | "GUEST";

type MembershipState =
  | { status: "loading" }
  | { status: "ready"; mediaRole: MediaRole; roleLabel: string }
  | { status: "error"; message: string; canRetry: boolean };

type MediaUiStatus = Exclude<LiveKitConnectionStatus, "error">;

type MediaState =
  { status: MediaUiStatus } | { status: "error"; message: string; canRetry: boolean };

function desktopMintApi() {
  const desktop = window.spectemusDesktop;
  return desktop?.mintPublicLiveKitToken ? desktop : null;
}

export function InternetRoomPage() {
  const { publicRoomId = "" } = useParams();
  const enabled = isInternetRoomChoiceEnabled();
  const roomIdValid = PUBLIC_ROOM_ID.test(publicRoomId);

  if (!enabled) {
    return (
      <InternetRoomShell title="Комната недоступна">
        <InternetRoomError message="Просмотр из другого города пока закрыт." canRetry={false} />
      </InternetRoomShell>
    );
  }

  if (!roomIdValid) {
    return (
      <InternetRoomShell title="Комната недоступна">
        <InternetRoomError message="Ссылка на комнату повреждена." canRetry={false} />
      </InternetRoomShell>
    );
  }

  return <InternetRoomSessionView key={publicRoomId} publicRoomId={publicRoomId} />;
}

function InternetRoomSessionView({ publicRoomId }: { publicRoomId: string }) {
  const abortRef = useRef<AbortController | null>(null);
  const connectionRef = useRef<LiveKitConnection | null>(null);
  const [membershipRetry, setMembershipRetry] = useState(0);
  const [mediaRetry, setMediaRetry] = useState(0);
  const [membership, setMembership] = useState<MembershipState>({ status: "loading" });
  const [media, setMedia] = useState<MediaState>({ status: "idle" });
  const [liveKitRoom, setLiveKitRoom] = useState<LiveKitRoom | null>(null);

  const isHost = membership.status === "ready" && membership.mediaRole === "HOST";
  const isGuest = membership.status === "ready" && membership.mediaRole === "GUEST";
  const desktopMediaReady = Boolean(
    window.spectemusDesktop?.pickMediaFile && window.spectemusDesktop?.releaseMedia,
  );
  const hostMedia = useInternetHostMediaPublish({
    enabled: isHost && desktopMediaReady,
    liveKitStatus: media.status,
    room: liveKitRoom,
  });
  const guestPlayback = useInternetGuestRemotePlayback({
    enabled: isGuest && media.status === "connected",
    room: liveKitRoom,
  });

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    const desktop = desktopMintApi();

    void (async () => {
      try {
        await Promise.resolve();
        if (controller.signal.aborted) {
          return;
        }
        if (desktop?.mintPublicLiveKitToken) {
          // Desktop membership is enforced by Bearer mint; cookie getPublicRoom is unavailable on loopback.
          setMembership({ status: "ready", mediaRole: "HOST", roleLabel: "хозяин" });
          return;
        }

        const access = await getPublicRoom(publicRoomId, controller.signal);
        if (!controller.signal.aborted) {
          const mediaRole: MediaRole = access.membership.role === "OWNER" ? "HOST" : "GUEST";
          setMembership({
            status: "ready",
            mediaRole,
            roleLabel: mediaRole === "HOST" ? "хозяин" : "гость",
          });
        }
      } catch (caught: unknown) {
        if (controller.signal.aborted) {
          return;
        }
        setMembership({
          status: "error",
          message: membershipErrorMessage(caught),
          canRetry: membershipErrorRetryable(caught),
        });
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [publicRoomId, membershipRetry]);

  useEffect(() => {
    if (membership.status !== "ready") {
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    void (async () => {
      try {
        await Promise.resolve();
        if (cancelled || controller.signal.aborted) {
          return;
        }
        setMedia({ status: "connecting" });
        setLiveKitRoom(null);
        const token = await fetchPublicLiveKitToken(publicRoomId, controller.signal);
        if (cancelled || controller.signal.aborted) {
          return;
        }
        if ("deviceCredential" in token || "apiOrigin" in token) {
          throw new Error("Device secret leaked into renderer LiveKit payload");
        }
        setMembership({
          status: "ready",
          mediaRole: token.role,
          roleLabel: token.role === "HOST" ? "хозяин" : "гость",
        });
        const connection = await connectLiveKitRoom(token, {
          onError: (message) => {
            if (!cancelled) {
              setLiveKitRoom(null);
              setMedia({ status: "error", message, canRetry: true });
            }
          },
          onStatusChange: (status) => {
            if (cancelled || status === "error") {
              return;
            }
            if (status === "disconnected") {
              setLiveKitRoom(null);
            }
            setMedia({ status });
          },
        });
        if (cancelled) {
          connection.disconnect();
          return;
        }
        connectionRef.current = connection;
        setLiveKitRoom(connection.room);
      } catch (caught: unknown) {
        if (cancelled || controller.signal.aborted) {
          return;
        }
        setLiveKitRoom(null);
        setMedia({
          status: "error",
          message: liveKitErrorMessage(caught),
          canRetry: liveKitErrorRetryable(caught),
        });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      connectionRef.current?.disconnect();
      connectionRef.current = null;
      setLiveKitRoom(null);
    };
  }, [publicRoomId, membership.status, mediaRetry]);

  const title =
    membership.status === "error"
      ? "Комната недоступна"
      : membership.status === "loading"
        ? "Проверяем доступ"
        : media.status === "connected"
          ? isHost
            ? hostMedia.status === "live"
              ? "Фильм опубликован"
              : "Подключено"
            : formatInternetRemotePlaybackStatus(guestPlayback.status)
          : media.status === "reconnecting"
            ? "Переподключение"
            : media.status === "connecting" || media.status === "idle"
              ? "Подключаем просмотр"
              : media.status === "error"
                ? "Подключение не удалось"
                : "Доступ получен";

  return (
    <InternetRoomShell title={title}>
      {membership.status === "loading" ? <p role="status">Проверяем членство в комнате…</p> : null}

      {membership.status === "ready" ? (
        <>
          <p className="internet-invite__meta">Роль: {membership.roleLabel}</p>
          {media.status === "connecting" || media.status === "idle" ? (
            <p role="status">Подключаемся к public LiveKit…</p>
          ) : null}
          {media.status === "connected" && isGuest ? (
            <InternetGuestPlaybackPanel playback={guestPlayback} />
          ) : null}
          {media.status === "connected" && isHost ? (
            <InternetHostMediaPanel
              hostMedia={hostMedia}
              liveKitConnected={media.status === "connected"}
            />
          ) : null}
          {media.status === "reconnecting" ? (
            <p role="status">Восстанавливаем соединение…</p>
          ) : null}
          {media.status === "disconnected" ? (
            <p role="status">Соединение прервано. Можно подключиться снова.</p>
          ) : null}
        </>
      ) : null}

      {membership.status === "error" ? (
        <InternetRoomError
          message={membership.message}
          canRetry={membership.canRetry}
          onRetry={() => {
            setMedia({ status: "idle" });
            setMembership({ status: "loading" });
            setMembershipRetry((value) => value + 1);
          }}
        />
      ) : null}

      {media.status === "error" ? (
        <InternetRoomError
          message={media.message}
          canRetry={media.canRetry}
          retryLabel="Подключить снова"
          onRetry={() => {
            setMedia({ status: "connecting" });
            setMediaRetry((value) => value + 1);
          }}
        />
      ) : null}

      {media.status === "disconnected" ? (
        <button
          className="button"
          onClick={() => {
            setMedia({ status: "connecting" });
            setMediaRetry((value) => value + 1);
          }}
          type="button"
        >
          Подключить снова
        </button>
      ) : null}
    </InternetRoomShell>
  );
}

function InternetGuestPlaybackPanel({
  playback,
}: {
  playback: ReturnType<typeof useInternetGuestRemotePlayback>;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { setElements, resumePlayback } = playback;

  useEffect(() => {
    setElements({
      audioElement: audioRef.current,
      videoElement: videoRef.current,
    });
    return () => {
      setElements({ audioElement: null, videoElement: null });
    };
  }, [setElements]);

  const statusLabel = formatInternetRemotePlaybackStatus(playback.status);
  const hint = formatInternetRemotePlaybackHint(playback.status, playback.error);
  const needsUserStart = isInternetRemotePlaybackUserActionRequired(playback.error);

  return (
    <div className="internet-invite__form" aria-label="Просмотр фильма">
      <div className="remote-player">
        <video ref={videoRef} className="remote-player__video" autoPlay playsInline muted />
        <audio ref={audioRef} autoPlay />
        {playback.status !== "receiving" ? (
          <div className="remote-player__overlay">
            <strong>{statusLabel}</strong>
            {hint ? <span>{hint}</span> : null}
            {playback.status === "error" && needsUserStart ? (
              <button
                className="button button--primary remote-player__resume-action"
                type="button"
                onClick={() => void resumePlayback()}
              >
                Запустить просмотр
              </button>
            ) : null}
            {playback.status === "error" && !needsUserStart && playback.error ? (
              <span role="alert">{playback.error}</span>
            ) : null}
          </div>
        ) : null}
      </div>
      <p className="internet-invite__meta" role="status">
        {statusLabel}
        {playback.videoTrackName ? ` · ${playback.videoTrackName}` : ""}
        {playback.audioTrackName ? ` · ${playback.audioTrackName}` : ""}
        {playback.status === "receiving" && !playback.audioTrackName ? " · без звука" : ""}
      </p>
    </div>
  );
}

function InternetHostMediaPanel({
  hostMedia,
  liveKitConnected,
}: {
  hostMedia: ReturnType<typeof useInternetHostMediaPublish>;
  liveKitConnected: boolean;
}) {
  if (!hostMedia.canUseDesktopMedia) {
    return (
      <p role="status">
        Подключение установлено. Публикация фильма доступна только в desktop-приложении хозяина.
      </p>
    );
  }

  return (
    <div className="internet-invite__form" aria-label="Публикация фильма">
      {hostMedia.status === "idle" ? (
        <p role="status">Выберите локальный фильм, чтобы опубликовать его в комнате.</p>
      ) : null}
      {hostMedia.status === "checking" ? <p role="status">Проверяем выбранный файл…</p> : null}
      {hostMedia.status === "normalizing" ? (
        <p role="status">
          Готовим файл к публикации
          {hostMedia.preparationProgress !== null ? `… ${hostMedia.preparationProgress}%` : "…"}
        </p>
      ) : null}
      {hostMedia.status === "ready" && hostMedia.displayName ? (
        <p role="status">Файл готов: {hostMedia.displayName}</p>
      ) : null}
      {hostMedia.status === "publishing" ? (
        <p role="status">Публикуем фильм в public LiveKit…</p>
      ) : null}
      {hostMedia.status === "live" ? (
        <p role="status">
          Фильм опубликован
          {hostMedia.displayName ? `: ${hostMedia.displayName}` : ""}. Дорожки movie-video /
          movie-audio активны.
        </p>
      ) : null}
      {hostMedia.status === "error" && hostMedia.error ? (
        <div className="internet-invite__error" role="alert">
          <p>{hostMedia.error}</p>
        </div>
      ) : null}

      <div className="internet-invite__meta">
        {hostMedia.status !== "publishing" &&
        hostMedia.status !== "checking" &&
        hostMedia.status !== "normalizing" &&
        hostMedia.status !== "live" ? (
          <button
            className="button"
            onClick={() => void hostMedia.selectAndPrepare()}
            type="button"
          >
            Выбрать файл
          </button>
        ) : null}
        {hostMedia.status === "ready" && liveKitConnected ? (
          <button className="button" onClick={() => void hostMedia.publish()} type="button">
            Опубликовать
          </button>
        ) : null}
        {hostMedia.status === "live" ? (
          <button className="button" onClick={() => hostMedia.stop()} type="button">
            Остановить публикацию
          </button>
        ) : null}
      </div>
    </div>
  );
}

async function fetchPublicLiveKitToken(
  publicRoomId: string,
  signal: AbortSignal,
): Promise<PublicLiveKitTokenResponse> {
  const desktop = desktopMintApi();
  if (desktop?.mintPublicLiveKitToken) {
    return unwrapDesktopIpcResult(await desktop.mintPublicLiveKitToken(publicRoomId));
  }
  return mintPublicLiveKitToken(publicRoomId, signal);
}

function problemStatus(caught: unknown) {
  return toApiProblemError(caught)?.problem.status;
}

function membershipErrorMessage(caught: unknown) {
  if (isAccountRequiredError(caught)) {
    return "Войдите по приглашению, чтобы открыть эту комнату.";
  }
  if (problemStatus(caught) === 404) {
    return "Комната недоступна для этого аккаунта.";
  }
  if (problemStatus(caught) === 429) {
    return "Слишком много попыток. Подождите немного и попробуйте снова.";
  }
  return "Не удалось проверить доступ к комнате. Попробуйте ещё раз чуть позже.";
}

function membershipErrorRetryable(caught: unknown) {
  if (isAccountRequiredError(caught)) {
    return false;
  }
  if (problemStatus(caught) === 404) {
    return false;
  }
  return true;
}

function liveKitErrorMessage(caught: unknown) {
  if (isAccountRequiredError(caught)) {
    return "Сессия входа закончилась. Войдите снова и подключитесь.";
  }
  const status = problemStatus(caught);
  if (status === 404) {
    return "Комната недоступна для этого аккаунта.";
  }
  if (status === 429) {
    return "Слишком много попыток подключения. Подождите немного и попробуйте снова.";
  }
  if (status !== undefined && status >= 500) {
    return "Public LiveKit временно недоступен. Попробуйте подключиться снова.";
  }
  return "Не удалось подключиться к public LiveKit. Попробуйте ещё раз.";
}

function liveKitErrorRetryable(caught: unknown) {
  if (isAccountRequiredError(caught)) {
    return false;
  }
  if (problemStatus(caught) === 404) {
    return false;
  }
  return true;
}

function InternetRoomShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      className="internet-invite internet-invite--guest"
      aria-labelledby="internet-room-title"
    >
      <p className="eyebrow">Internet-комната</p>
      <h1 id="internet-room-title">{title}</h1>
      {children}
    </section>
  );
}

function InternetRoomError({
  message,
  canRetry,
  onRetry,
  retryLabel = "Повторить",
}: {
  message: string;
  canRetry: boolean;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="internet-invite__error" role="alert">
      <p>{message}</p>
      {canRetry && onRetry ? (
        <button className="button" onClick={onRetry} type="button">
          {retryLabel}
        </button>
      ) : (
        <Link className="button" to="/">
          На главную
        </Link>
      )}
    </div>
  );
}
