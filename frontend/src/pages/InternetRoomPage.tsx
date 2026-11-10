import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

import {
  ApiProblemError,
  getPublicRoom,
  isAccountRequiredError,
  type PublicRoomAccess,
} from "../features/internet/internet-api";
import { isInternetRoomChoiceEnabled } from "../features/rooms/room-mode";

const PUBLIC_ROOM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RoomViewState =
  | { status: "loading" }
  | { status: "ready"; access: PublicRoomAccess }
  | { status: "error"; message: string; canRetry: boolean };

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

  return <InternetRoomMembershipView publicRoomId={publicRoomId} />;
}

function InternetRoomMembershipView({ publicRoomId }: { publicRoomId: string }) {
  const abortRef = useRef<AbortController | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [state, setState] = useState<RoomViewState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;

    void getPublicRoom(publicRoomId, controller.signal)
      .then((access) => {
        if (!controller.signal.aborted) {
          setState({ status: "ready", access });
        }
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        if (isAccountRequiredError(caught)) {
          setState({
            status: "error",
            message: "Войдите по приглашению, чтобы открыть эту комнату.",
            canRetry: false,
          });
          return;
        }
        if (caught instanceof ApiProblemError && caught.problem.status === 404) {
          setState({
            status: "error",
            message: "Комната недоступна для этого аккаунта.",
            canRetry: false,
          });
          return;
        }
        if (caught instanceof ApiProblemError && caught.problem.status === 429) {
          setState({
            status: "error",
            message: "Слишком много попыток. Подождите немного и попробуйте снова.",
            canRetry: true,
          });
          return;
        }
        setState({
          status: "error",
          message: "Не удалось проверить доступ к комнате. Попробуйте ещё раз чуть позже.",
          canRetry: true,
        });
      })
      .finally(() => {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      });

    return () => {
      controller.abort();
    };
  }, [publicRoomId, retryToken]);

  const title =
    state.status === "ready"
      ? "Доступ получен"
      : state.status === "loading"
        ? "Проверяем доступ"
        : "Комната недоступна";

  return (
    <InternetRoomShell title={title}>
      {state.status === "loading" ? <p role="status">Проверяем членство в комнате…</p> : null}

      {state.status === "ready" ? (
        <>
          <p>
            Доступ получен, подключение просмотра готовится. Видео и LiveKit в этом шаге ещё не
            подключаются.
          </p>
          <p className="internet-invite__meta">
            Роль: {state.access.membership.role === "OWNER" ? "хозяин" : "гость"}
          </p>
        </>
      ) : null}

      {state.status === "error" ? (
        <InternetRoomError
          message={state.message}
          canRetry={state.canRetry}
          onRetry={() => {
            setState({ status: "loading" });
            setRetryToken((value) => value + 1);
          }}
        />
      ) : null}
    </InternetRoomShell>
  );
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
}: {
  message: string;
  canRetry: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className="internet-invite__error" role="alert">
      <p>{message}</p>
      {canRetry && onRetry ? (
        <button className="button" onClick={onRetry} type="button">
          Повторить
        </button>
      ) : (
        <Link className="button" to="/">
          На главную
        </Link>
      )}
    </div>
  );
}
