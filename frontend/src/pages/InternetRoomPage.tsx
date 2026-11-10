import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

import {
  ApiProblemError,
  getPublicRoom,
  isAccountRequiredError,
  mintPublicLiveKitToken,
  type PublicLiveKitTokenResponse,
} from "../features/internet/internet-api";
import {
  connectLiveKitRoom,
  type LiveKitConnection,
  type LiveKitConnectionStatus,
} from "../features/rooms/livekit-connection";
import { isInternetRoomChoiceEnabled } from "../features/rooms/room-mode";

const PUBLIC_ROOM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type MembershipState =
  | { status: "loading" }
  | { status: "ready"; roleLabel: string }
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
          setMembership({ status: "ready", roleLabel: "хозяин" });
          return;
        }

        const access = await getPublicRoom(publicRoomId, controller.signal);
        if (!controller.signal.aborted) {
          setMembership({
            status: "ready",
            roleLabel: access.membership.role === "OWNER" ? "хозяин" : "гость",
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
        const token = await fetchPublicLiveKitToken(publicRoomId, controller.signal);
        if (cancelled || controller.signal.aborted) {
          return;
        }
        if ("deviceCredential" in token || "apiOrigin" in token) {
          throw new Error("Device secret leaked into renderer LiveKit payload");
        }
        if (desktopMintApi()) {
          setMembership({
            status: "ready",
            roleLabel: token.role === "HOST" ? "хозяин" : "гость",
          });
        }
        const connection = await connectLiveKitRoom(token, {
          onError: (message) => {
            if (!cancelled) {
              setMedia({ status: "error", message, canRetry: true });
            }
          },
          onStatusChange: (status) => {
            if (cancelled || status === "error") {
              return;
            }
            setMedia({ status });
          },
        });
        if (cancelled) {
          connection.disconnect();
          return;
        }
        connectionRef.current = connection;
      } catch (caught: unknown) {
        if (cancelled || controller.signal.aborted) {
          return;
        }
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
    };
  }, [publicRoomId, membership.status, mediaRetry]);

  const title =
    membership.status === "error"
      ? "Комната недоступна"
      : membership.status === "loading"
        ? "Проверяем доступ"
        : media.status === "connected"
          ? "Подключено"
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
          {media.status === "connected" ? (
            <p role="status">Подключение установлено. Передача фильма появится отдельным шагом.</p>
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

async function fetchPublicLiveKitToken(
  publicRoomId: string,
  signal: AbortSignal,
): Promise<PublicLiveKitTokenResponse> {
  const desktop = desktopMintApi();
  if (desktop?.mintPublicLiveKitToken) {
    return desktop.mintPublicLiveKitToken(publicRoomId);
  }
  return mintPublicLiveKitToken(publicRoomId, signal);
}

function membershipErrorMessage(caught: unknown) {
  if (isAccountRequiredError(caught)) {
    return "Войдите по приглашению, чтобы открыть эту комнату.";
  }
  if (caught instanceof ApiProblemError && caught.problem.status === 404) {
    return "Комната недоступна для этого аккаунта.";
  }
  if (caught instanceof ApiProblemError && caught.problem.status === 429) {
    return "Слишком много попыток. Подождите немного и попробуйте снова.";
  }
  return "Не удалось проверить доступ к комнате. Попробуйте ещё раз чуть позже.";
}

function membershipErrorRetryable(caught: unknown) {
  if (isAccountRequiredError(caught)) {
    return false;
  }
  if (caught instanceof ApiProblemError && caught.problem.status === 404) {
    return false;
  }
  return true;
}

function liveKitErrorMessage(caught: unknown) {
  if (isAccountRequiredError(caught)) {
    return "Сессия входа закончилась. Войдите снова и подключитесь.";
  }
  if (caught instanceof ApiProblemError && caught.problem.status === 404) {
    return "Комната недоступна для этого аккаунта.";
  }
  if (caught instanceof ApiProblemError && caught.problem.status === 429) {
    return "Слишком много попыток подключения. Подождите немного и попробуйте снова.";
  }
  if (caught instanceof ApiProblemError && caught.problem.status >= 500) {
    return "Public LiveKit временно недоступен. Попробуйте подключиться снова.";
  }
  return "Не удалось подключиться к public LiveKit. Попробуйте ещё раз.";
}

function liveKitErrorRetryable(caught: unknown) {
  if (isAccountRequiredError(caught)) {
    return false;
  }
  if (caught instanceof ApiProblemError && caught.problem.status === 404) {
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
