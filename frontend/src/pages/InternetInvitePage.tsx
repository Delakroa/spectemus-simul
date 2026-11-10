import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  ApiProblemError,
  createInviteRedemptionIdempotencyKey,
  getAccount,
  isAccountLimitReachedError,
  isAccountRequiredError,
  isChallengeRejectedError,
  isInviteUnavailableError,
  redeemPublicInvite,
  requestEmailChallenge,
  verifyEmailChallenge,
} from "../features/internet/internet-api";
import {
  readInternetInviteToken,
  recognizeInternetInviteHash,
  type InternetInviteRecognition,
} from "../features/rooms/internet-invite";
import { isInternetRoomChoiceEnabled } from "../features/rooms/room-mode";

const CHALLENGE_NEUTRAL_MESSAGE =
  "Если этот адрес подходит, мы отправили одноразовый код. Введите его и своё имя для просмотра.";

type GuestStep = "bootstrap" | "email" | "code" | "redeeming" | "error";

type GuestError = {
  kind: "invite" | "auth" | "limit" | "rate" | "temporary";
  message: string;
  canRetry: boolean;
  canRequestNewCode?: boolean;
};

export function InternetInvitePage() {
  const location = useLocation();

  if (!isInternetRoomChoiceEnabled()) {
    return <ClosedInternetInviteView hash={location.hash} />;
  }

  // Remount on hash change so a new invite token gets a fresh token/idempotency state.
  return <InternetGuestInviteEntry key={location.hash || "missing"} hash={location.hash} />;
}

function ClosedInternetInviteView({ hash }: { hash: string }) {
  const recognition = recognizeInternetInviteHash(hash);

  return (
    <section className="internet-invite" aria-labelledby="internet-invite-title">
      <p className="eyebrow">Приглашение</p>
      <h1 id="internet-invite-title">Просмотр из другого города пока закрыт</h1>
      <p>
        Эта ссылка не открывает комнату в домашней сети и не даёт выбрать фильм, поставить паузу или
        перемотать просмотр.
      </p>
      <p>{inviteExplanation(recognition)}</p>
    </section>
  );
}

function InternetGuestInviteEntry({ hash }: { hash: string }) {
  const navigate = useNavigate();
  const recognition = recognizeInternetInviteHash(hash);
  const inviteTokenRef = useRef(readInternetInviteToken(hash));
  const idempotencyKeyRef = useRef(createInviteRedemptionIdempotencyKey());
  const challengeIdRef = useRef<string | null>(null);
  const codeRef = useRef("");
  const abortRef = useRef<AbortController | null>(null);

  const [step, setStep] = useState<GuestStep>(recognition === "present" ? "bootstrap" : "error");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<GuestError | null>(() =>
    recognition === "present"
      ? null
      : {
          kind: "invite",
          message:
            recognition === "invalid"
              ? "Ссылка приглашения повреждена. Попросите хозяина комнаты прислать её ещё раз."
              : "Откройте полную ссылку от хозяина комнаты. Фрагмент после решётки остаётся в браузере и не уходит на сервер.",
          canRetry: false,
        },
  );
  const [challengeHint, setChallengeHint] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (recognition !== "present") {
      return;
    }

    void bootstrapSession();
    // Fresh mount (including hash remount) bootstraps this invite once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function beginRequest() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPending(true);
    setError(null);
    return controller;
  }

  function finishRequest(controller: AbortController) {
    if (abortRef.current === controller) {
      abortRef.current = null;
      setPending(false);
    }
  }

  async function bootstrapSession() {
    const token = inviteTokenRef.current;
    if (!token) {
      return;
    }

    const controller = beginRequest();
    setStep("bootstrap");
    try {
      await getAccount(controller.signal);
      await redeemInvite(controller);
    } catch (caught) {
      if (controller.signal.aborted) {
        return;
      }
      if (isAccountRequiredError(caught)) {
        setStep("email");
        setPending(false);
        return;
      }
      applyFlowError(caught);
      setPending(false);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }

  async function redeemInvite(controller: AbortController) {
    const token = inviteTokenRef.current;
    if (!token) {
      throw new Error("invite token missing");
    }

    setStep("redeeming");
    const access = await redeemPublicInvite(token, idempotencyKeyRef.current, controller.signal);
    inviteTokenRef.current = null;
    challengeIdRef.current = null;
    codeRef.current = "";
    setCode("");
    navigate(`/internet/rooms/${access.room.publicRoomId}`, { replace: true });
  }

  function applyFlowError(caught: unknown) {
    if (isInviteUnavailableError(caught)) {
      setStep("error");
      setError({
        kind: "invite",
        message: "Приглашение недействительно или больше не доступно",
        canRetry: false,
      });
      return;
    }

    if (isAccountLimitReachedError(caught)) {
      setStep("error");
      setError({
        kind: "limit",
        message: "В комнате нет свободных мест",
        canRetry: false,
      });
      return;
    }

    if (isAccountRequiredError(caught)) {
      setStep("email");
      setError({
        kind: "auth",
        message: "Войдите по email, чтобы принять приглашение.",
        canRetry: false,
      });
      return;
    }

    if (caught instanceof ApiProblemError && caught.problem.status === 429) {
      setStep("error");
      setError({
        kind: "rate",
        message: "Слишком много попыток. Подождите немного и попробуйте снова.",
        canRetry: true,
      });
      return;
    }

    setStep("error");
    setError({
      kind: "temporary",
      message: "Не удалось связаться с сервисом. Попробуйте ещё раз чуть позже.",
      canRetry: true,
    });
  }

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const controller = beginRequest();
    try {
      const accepted = await requestEmailChallenge(email.trim(), controller.signal);
      challengeIdRef.current = accepted.challengeId;
      setChallengeHint(CHALLENGE_NEUTRAL_MESSAGE);
      setStep("code");
    } catch (caught) {
      if (controller.signal.aborted) {
        return;
      }
      applyFlowError(caught);
    } finally {
      finishRequest(controller);
    }
  }

  async function handleCodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const challengeId = challengeIdRef.current;
    if (!challengeId) {
      setStep("email");
      return;
    }

    const controller = beginRequest();
    codeRef.current = code.trim();
    try {
      await verifyEmailChallenge(
        challengeId,
        {
          code: codeRef.current,
          displayName: displayName.trim(),
        },
        controller.signal,
      );
      challengeIdRef.current = null;
      codeRef.current = "";
      setCode("");
      await redeemInvite(controller);
    } catch (caught) {
      if (controller.signal.aborted) {
        return;
      }
      if (isChallengeRejectedError(caught)) {
        setStep("code");
        setError({
          kind: "auth",
          message: "Код не принят. Проверьте ввод или получите новый код.",
          canRetry: false,
          canRequestNewCode: true,
        });
        setPending(false);
        return;
      }
      if (isAccountRequiredError(caught)) {
        setStep("email");
        setError({
          kind: "auth",
          message: "Войдите по email, чтобы принять приглашение.",
          canRetry: false,
        });
        setPending(false);
        return;
      }
      applyFlowError(caught);
      setPending(false);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }

  function handleRetry() {
    if (recognition !== "present") {
      return;
    }
    if (challengeIdRef.current) {
      setStep("code");
      setError(null);
      return;
    }
    void bootstrapSession();
  }

  function handleRequestNewCode() {
    challengeIdRef.current = null;
    codeRef.current = "";
    setCode("");
    setChallengeHint(null);
    setError(null);
    setStep("email");
  }

  return (
    <section
      className="internet-invite internet-invite--guest"
      aria-labelledby="internet-invite-title"
    >
      <p className="eyebrow">Приглашение</p>
      <h1 id="internet-invite-title">Вход в комнату по приглашению</h1>
      <p>
        Здесь нет создания комнаты, выбора файла и управления просмотром. Нужны только ваши данные
        для входа.
      </p>

      {step === "bootstrap" || step === "redeeming" ? <p role="status">Проверяем доступ…</p> : null}

      {step === "email" ? (
        <form className="internet-invite__form" onSubmit={handleEmailSubmit}>
          <label htmlFor="internet-guest-email">Email</label>
          <input
            autoComplete="email"
            id="internet-guest-email"
            inputMode="email"
            maxLength={254}
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
          <button className="button button--primary" disabled={pending} type="submit">
            Получить код
          </button>
        </form>
      ) : null}

      {step === "code" ? (
        <form className="internet-invite__form" onSubmit={handleCodeSubmit}>
          {challengeHint ? <p role="status">{challengeHint}</p> : null}
          <label htmlFor="internet-guest-code">Одноразовый код</label>
          <input
            autoComplete="one-time-code"
            id="internet-guest-code"
            maxLength={12}
            minLength={6}
            name="code"
            onChange={(event) => setCode(event.target.value)}
            pattern="[A-Za-z0-9]+"
            required
            type="text"
            value={code}
          />
          <label htmlFor="internet-guest-display-name">Ваше имя</label>
          <input
            autoComplete="nickname"
            id="internet-guest-display-name"
            maxLength={64}
            minLength={1}
            name="displayName"
            onChange={(event) => setDisplayName(event.target.value)}
            required
            type="text"
            value={displayName}
          />
          <button className="button button--primary" disabled={pending} type="submit">
            Войти
          </button>
        </form>
      ) : null}

      {error ? (
        <div className="internet-invite__error" role="alert">
          <p>{error.message}</p>
          {error.canRetry ? (
            <button className="button" disabled={pending} onClick={handleRetry} type="button">
              Повторить
            </button>
          ) : null}
          {error.canRequestNewCode ? (
            <button
              className="button"
              disabled={pending}
              onClick={handleRequestNewCode}
              type="button"
            >
              Получить новый код
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function inviteExplanation(recognition: InternetInviteRecognition) {
  if (recognition === "present") {
    return "Приглашение распознано, но просмотр из другого города гостям ещё не открыт.";
  }

  if (recognition === "invalid") {
    return "Ссылка приглашения повреждена. Попросите хозяина комнаты прислать её ещё раз.";
  }

  return "Откройте полную ссылку от хозяина комнаты. Фрагмент после решётки остаётся в браузере и не уходит на сервер.";
}
