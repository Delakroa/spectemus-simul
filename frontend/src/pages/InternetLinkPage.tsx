import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

import {
  ApiProblemError,
  approveDeviceBinding,
  getAccount,
  isAccountRequiredError,
  isChallengeRejectedError,
  isDeviceBindingUnavailableError,
  requestEmailChallenge,
  verifyEmailChallenge,
} from "../features/internet/internet-api";
import { getInternetAppOrigin } from "../features/internet/internet-origin";
import { isInternetRoomChoiceEnabled } from "../features/rooms/room-mode";

const USER_CODE_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const BINDING_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHALLENGE_NEUTRAL_MESSAGE =
  "Если этот адрес подходит, мы отправили одноразовый код. Введите его, чтобы подтвердить привязку.";

type LinkStep = "bootstrap" | "email" | "code" | "confirm" | "done" | "error";

export function InternetLinkPage() {
  if (!isInternetRoomChoiceEnabled() || !getInternetAppOrigin()) {
    return (
      <InternetLinkShell title="Привязка недоступна">
        <p>Подтверждение desktop-привязки сейчас закрыто.</p>
        <Link className="button" to="/">
          На главную
        </Link>
      </InternetLinkShell>
    );
  }

  return <InternetLinkEntry />;
}

function InternetLinkEntry() {
  const location = useLocation();
  const parsed = useMemo(() => parseLinkHash(location.hash), [location.hash]);
  const abortRef = useRef<AbortController | null>(null);
  const challengeIdRef = useRef<string | null>(null);

  const [step, setStep] = useState<LinkStep>(parsed.bindingId ? "bootstrap" : "error");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [userCode, setUserCode] = useState(parsed.userCode ?? "");
  const [pending, setPending] = useState(false);
  const [challengeHint, setChallengeHint] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(
    parsed.bindingId
      ? null
      : "Откройте ссылку подтверждения из desktop-приложения Spectemus Simul.",
  );

  function beginRequest() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPending(true);
    setMessage(null);
    return controller;
  }

  function finishRequest(controller: AbortController) {
    if (abortRef.current === controller) {
      abortRef.current = null;
      setPending(false);
    }
  }

  async function bootstrap() {
    const controller = beginRequest();
    setStep("bootstrap");
    try {
      await getAccount(controller.signal);
      setStep("confirm");
    } catch (caught) {
      if (controller.signal.aborted) {
        return;
      }
      if (isAccountRequiredError(caught)) {
        setStep("email");
        return;
      }
      setStep("error");
      setMessage("Не удалось проверить аккаунт. Попробуйте ещё раз чуть позже.");
    } finally {
      finishRequest(controller);
    }
  }

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!parsed.bindingId) {
      return;
    }
    let cancelled = false;
    void (async () => {
      // Yield so account bootstrap is not a synchronous setState inside the effect.
      await Promise.resolve();
      if (cancelled) {
        return;
      }
      await bootstrap();
    })();
    return () => {
      cancelled = true;
    };
    // Fresh mount / hash remount bootstraps account once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed.bindingId]);

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
      setStep("error");
      setMessage(
        caught instanceof ApiProblemError && caught.problem.status === 429
          ? "Слишком много попыток. Подождите немного и попробуйте снова."
          : "Не удалось отправить код. Попробуйте ещё раз чуть позже.",
      );
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
    try {
      await verifyEmailChallenge(
        challengeId,
        { code: code.trim(), displayName: displayName.trim() || undefined },
        controller.signal,
      );
      challengeIdRef.current = null;
      setCode("");
      setStep("confirm");
    } catch (caught) {
      if (controller.signal.aborted) {
        return;
      }
      if (isChallengeRejectedError(caught)) {
        setMessage("Код не принят. Проверьте ввод или запросите новый.");
        setPending(false);
        return;
      }
      setStep("error");
      setMessage("Не удалось подтвердить вход. Попробуйте ещё раз чуть позже.");
      setPending(false);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }

  async function handleConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!parsed.bindingId || !USER_CODE_PATTERN.test(userCode.trim().toUpperCase())) {
      setMessage("Проверьте код подтверждения из desktop-приложения.");
      return;
    }
    const controller = beginRequest();
    try {
      await approveDeviceBinding(
        parsed.bindingId,
        userCode.trim().toUpperCase(),
        controller.signal,
      );
      setStep("done");
      setMessage("Привязка подтверждена. Вернитесь в desktop-приложение Spectemus Simul.");
    } catch (caught) {
      if (controller.signal.aborted) {
        return;
      }
      if (isAccountRequiredError(caught)) {
        setStep("email");
        setMessage("Войдите по email, чтобы подтвердить привязку.");
        setPending(false);
        return;
      }
      if (isDeviceBindingUnavailableError(caught)) {
        setStep("error");
        setMessage("Привязка недействительна или больше не доступна.");
        setPending(false);
        return;
      }
      setStep("error");
      setMessage(
        caught instanceof ApiProblemError && caught.problem.status === 429
          ? "Слишком много попыток. Подождите немного и попробуйте снова."
          : "Не удалось подтвердить привязку. Попробуйте ещё раз чуть позже.",
      );
      setPending(false);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
    setStep("error");
    setMessage("Подтверждение отменено. Можно закрыть эту вкладку.");
  }

  return (
    <InternetLinkShell title="Привязка desktop-приложения">
      <p>
        Подтвердите одноразовую привязку Spectemus Simul. Session credential не передаётся в адресе
        страницы.
      </p>

      {step === "bootstrap" ? <p role="status">Проверяем аккаунт…</p> : null}

      {step === "email" ? (
        <form className="internet-invite__form" onSubmit={handleEmailSubmit}>
          <label htmlFor="internet-link-email">Email</label>
          <input
            autoComplete="email"
            id="internet-link-email"
            maxLength={254}
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
          <label htmlFor="internet-link-code">Одноразовый код</label>
          <input
            autoComplete="one-time-code"
            id="internet-link-code"
            maxLength={12}
            onChange={(event) => setCode(event.target.value)}
            required
            type="text"
            value={code}
          />
          <label htmlFor="internet-link-display-name">Ваше имя</label>
          <input
            id="internet-link-display-name"
            maxLength={64}
            onChange={(event) => setDisplayName(event.target.value)}
            type="text"
            value={displayName}
          />
          <button className="button button--primary" disabled={pending} type="submit">
            Войти
          </button>
        </form>
      ) : null}

      {step === "confirm" ? (
        <form className="internet-invite__form" onSubmit={handleConfirm}>
          <label htmlFor="internet-link-user-code">Код из приложения</label>
          <input
            id="internet-link-user-code"
            maxLength={9}
            onChange={(event) => setUserCode(event.target.value.toUpperCase())}
            pattern="[A-Z0-9]{4}-[A-Z0-9]{4}"
            required
            type="text"
            value={userCode}
          />
          <button className="button button--primary" disabled={pending} type="submit">
            Подтвердить привязку
          </button>
          <button className="button" disabled={pending} onClick={handleCancel} type="button">
            Отменить
          </button>
        </form>
      ) : null}

      {step === "done" || step === "error" || message ? (
        <div className="internet-invite__error" role={step === "error" ? "alert" : "status"}>
          {message ? <p>{message}</p> : null}
          {step === "error" || step === "done" ? (
            <Link className="button" to="/">
              На главную
            </Link>
          ) : null}
        </div>
      ) : null}
    </InternetLinkShell>
  );
}

function parseLinkHash(hash: string): { bindingId: string | null; userCode: string | null } {
  const normalized = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!normalized) {
    return { bindingId: null, userCode: null };
  }
  const params = new URLSearchParams(normalized);
  const bindingId = params.get("binding");
  const userCode = params.get("code");
  return {
    bindingId: bindingId && BINDING_ID_PATTERN.test(bindingId) ? bindingId : null,
    userCode: userCode && USER_CODE_PATTERN.test(userCode) ? userCode : null,
  };
}

function InternetLinkShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      className="internet-invite internet-invite--guest"
      aria-labelledby="internet-link-title"
    >
      <p className="eyebrow">Desktop</p>
      <h1 id="internet-link-title">{title}</h1>
      {children}
    </section>
  );
}
