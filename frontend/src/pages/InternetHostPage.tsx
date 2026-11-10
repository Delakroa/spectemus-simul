import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";

import {
  ApiProblemError,
  createPublicInviteIdempotencyKey,
  createPublicRoom,
  createPublicRoomIdempotencyKey,
  createPublicRoomInvite,
  getAccount,
  isAccountRequiredError,
  isChallengeRejectedError,
  isIdempotencyReplayUnavailableError,
  requestEmailChallenge,
  verifyEmailChallenge,
  type PublicRoomAccess,
} from "../features/internet/internet-api";
import {
  createInternetInviteUrl,
  getInternetAppOrigin,
} from "../features/internet/internet-origin";
import { copyText } from "../features/rooms/copy-text";
import type {
  DesktopDeviceBindingStart,
  SpectemusDesktopApi,
} from "../features/rooms/desktop-media";
import { isInternetRoomChoiceEnabled } from "../features/rooms/room-mode";

const ROOM_EXPIRES_IN_MINUTES = 180;
const INVITE_EXPIRES_IN_MINUTES = 180;
const INVITE_MAX_REDEMPTIONS = 3;
const CHALLENGE_NEUTRAL_MESSAGE =
  "Если этот адрес подходит, мы отправили одноразовый код. Введите его, чтобы продолжить.";
const INTERNET_ACCOUNT_QUERY_KEY = ["internet", "account"] as const;

type HostStep =
  "bootstrap" | "email" | "code" | "bind" | "waiting" | "ready" | "creating" | "created" | "error";

type HostError = {
  message: string;
  retryAction: "bootstrap" | "email" | "code" | "bind" | "create" | null;
  canRequestNewCode?: boolean;
};

type CreatedInternetRoom = {
  access: PublicRoomAccess;
  inviteUrl: string;
};

function desktopBindingApi(): SpectemusDesktopApi | null {
  const desktop = window.spectemusDesktop;
  if (
    !desktop?.getDeviceBindingStatus ||
    !desktop.startDeviceBinding ||
    !desktop.openDeviceBinding ||
    !desktop.pollDeviceBinding ||
    !desktop.cancelDeviceBinding ||
    !desktop.createPublicRoomWithDeviceBinding ||
    !desktop.createPublicInviteWithDeviceBinding
  ) {
    return null;
  }
  return desktop;
}

export function InternetHostPage() {
  if (!isInternetRoomChoiceEnabled()) {
    return (
      <InternetHostShell title="Internet-комната пока закрыта">
        <p>Создание комнаты для просмотра из разных городов ещё не включено.</p>
        <Link className="button" to="/">
          На главную
        </Link>
      </InternetHostShell>
    );
  }

  const appOrigin = getInternetAppOrigin();
  if (!appOrigin) {
    return (
      <InternetHostShell title="Internet-комната не настроена">
        <p>
          Для безопасного приглашения нужен публичный HTTPS-адрес приложения. Локальная LAN-комната
          при этом не создаётся.
        </p>
        <Link className="button" to="/">
          На главную
        </Link>
      </InternetHostShell>
    );
  }

  const desktop = desktopBindingApi();
  if (desktop) {
    return <DesktopInternetHostEntry appOrigin={appOrigin} desktop={desktop} />;
  }

  return <InternetHostEntry appOrigin={appOrigin} />;
}

function DesktopInternetHostEntry({
  appOrigin,
  desktop,
}: {
  appOrigin: string;
  desktop: SpectemusDesktopApi;
}) {
  const pollTimerRef = useRef<number | null>(null);
  const roomIdempotencyKeyRef = useRef(createPublicRoomIdempotencyKey());
  const inviteIdempotencyKeyRef = useRef(createPublicInviteIdempotencyKey());
  const createdRoomRef = useRef<PublicRoomAccess | null>(null);

  const [step, setStep] = useState<HostStep>("bootstrap");
  const [pending, setPending] = useState(false);
  const [binding, setBinding] = useState<DesktopDeviceBindingStart | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [error, setError] = useState<HostError | null>(null);
  const [created, setCreated] = useState<CreatedInternetRoom | null>(null);
  const [hasCreatedRoom, setHasCreatedRoom] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");

  function stopPolling() {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  async function bootstrap() {
    setPending(true);
    setError(null);
    setStep("bootstrap");
    try {
      const status = await desktop.getDeviceBindingStatus!();
      if (status.bound) {
        setDisplayName(status.profile.displayName);
        setStep("ready");
        return;
      }
      setStep("bind");
    } catch {
      setStep("error");
      setError({
        message: "Не удалось проверить привязку desktop. Попробуйте ещё раз чуть позже.",
        retryAction: "bootstrap",
      });
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) {
        await bootstrap();
      }
    })();
    return () => {
      cancelled = true;
      stopPolling();
      void desktop.cancelDeviceBinding?.();
    };
    // Bootstrap once on mount for the desktop binding surface.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startBinding() {
    stopPolling();
    setPending(true);
    setError(null);
    try {
      const started = await desktop.startDeviceBinding!(appOrigin);
      if ("deviceCode" in started || "deviceCredential" in started) {
        throw new Error("Device secret leaked into renderer payload");
      }
      setBinding(started);
      await desktop.openDeviceBinding!(started.verificationUri);
      setStep("waiting");
      schedulePoll(started.intervalSeconds);
    } catch {
      setStep("error");
      setError({
        message: "Не удалось начать привязку. Проверьте публичный HTTPS origin и попробуйте снова.",
        retryAction: "bind",
      });
    } finally {
      setPending(false);
    }
  }

  function schedulePoll(intervalSeconds: number) {
    stopPolling();
    const delayMs = Math.max(0, Number(intervalSeconds) || 0) * 1000;
    pollTimerRef.current = window.setTimeout(() => {
      void pollBinding();
    }, delayMs);
  }

  async function pollBinding() {
    try {
      const result = await desktop.pollDeviceBinding!();
      if ("deviceCredential" in result || "deviceCode" in result) {
        throw new Error("Device secret leaked into renderer payload");
      }
      if (result.status === "pending") {
        schedulePoll(result.intervalSeconds);
        return;
      }
      setDisplayName(result.profile.displayName);
      setBinding(null);
      setStep("ready");
    } catch {
      stopPolling();
      setStep("error");
      setError({
        message: "Привязка не завершилась. Запросите новое подтверждение.",
        retryAction: "bind",
      });
    }
  }

  function handleCancelBinding() {
    stopPolling();
    void desktop.cancelDeviceBinding?.();
    setBinding(null);
    setStep("error");
    setError({
      message: "Подтверждение отменено. Можно начать привязку заново.",
      retryAction: "bind",
    });
  }

  async function createRoomAndInvite() {
    setPending(true);
    setError(null);
    setStep("creating");
    try {
      let access = createdRoomRef.current;
      if (!access) {
        access = (await desktop.createPublicRoomWithDeviceBinding!({
          expiresInMinutes: ROOM_EXPIRES_IN_MINUTES,
          idempotencyKey: roomIdempotencyKeyRef.current,
        })) as PublicRoomAccess;
        createdRoomRef.current = access;
        setHasCreatedRoom(true);
      }

      const invite = await desktop.createPublicInviteWithDeviceBinding!({
        publicRoomId: access.room.publicRoomId,
        expiresInMinutes: INVITE_EXPIRES_IN_MINUTES,
        maxRedemptions: INVITE_MAX_REDEMPTIONS,
        idempotencyKey: inviteIdempotencyKeyRef.current,
      });
      setCreated({
        access,
        inviteUrl: createInternetInviteUrl(appOrigin, invite.invitePath),
      });
      setStep("created");
    } catch (caught) {
      if (
        caught &&
        typeof caught === "object" &&
        "code" in caught &&
        (caught as { code?: string }).code === "IDEMPOTENCY_REPLAY_UNAVAILABLE"
      ) {
        inviteIdempotencyKeyRef.current = createPublicInviteIdempotencyKey();
        setStep("error");
        setError({
          message: "Прежнюю ссылку нельзя восстановить. Создайте новое приглашение.",
          retryAction: "create",
        });
        return;
      }
      setStep("error");
      setError({
        message: "Не удалось создать Internet-комнату. Попробуйте ещё раз чуть позже.",
        retryAction: "create",
      });
    } finally {
      setPending(false);
    }
  }

  async function handleCopyInvite() {
    if (!created) {
      return;
    }
    try {
      await copyText(created.inviteUrl);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  }

  return (
    <InternetHostShell title="Создать Internet-комнату">
      <p>
        Desktop подтверждает public account в системном браузере. Session credential остаётся в main
        process и не попадает в renderer.
      </p>

      {step === "bootstrap" ? <p role="status">Проверяем привязку…</p> : null}

      {step === "bind" ? (
        <div className="internet-host__ready">
          <p>
            Чтобы создать комнату «Из разных городов», подтвердите аккаунт в системном браузере.
            Cookie браузера не ослабляется ради Electron loopback.
          </p>
          <button
            className="button button--primary"
            disabled={pending}
            onClick={() => void startBinding()}
            type="button"
          >
            Подтвердить аккаунт в браузере
          </button>
        </div>
      ) : null}

      {step === "waiting" && binding ? (
        <div className="internet-host__ready" role="status">
          <p>Откройте системный браузер и введите код подтверждения:</p>
          <p>
            <strong>{binding.userCode}</strong>
          </p>
          <p>Ожидаем подтверждение…</p>
          <button className="button" onClick={handleCancelBinding} type="button">
            Отменить
          </button>
        </div>
      ) : null}

      {step === "ready" ? (
        <div className="internet-host__ready">
          <p>
            Desktop привязан{displayName ? `: ${displayName}` : ""}. Можно создать приватную комнату
            и ссылку для гостя.
          </p>
          <button
            className="button button--primary"
            disabled={pending}
            onClick={() => void createRoomAndInvite()}
            type="button"
          >
            {hasCreatedRoom ? "Продолжить создание приглашения" : "Создать комнату"}
          </button>
          <button
            className="button"
            disabled={pending}
            onClick={() => {
              void desktop.clearDeviceBinding?.().then(() => {
                createdRoomRef.current = null;
                setHasCreatedRoom(false);
                setCreated(null);
                setDisplayName(null);
                setStep("bind");
              });
            }}
            type="button"
          >
            Отвязать аккаунт
          </button>
        </div>
      ) : null}

      {step === "creating" ? <p role="status">Создаём комнату и приглашение…</p> : null}

      {step === "created" && created ? (
        <CreatedRoomResult
          created={created}
          copyStatus={copyStatus}
          onCopy={() => void handleCopyInvite()}
        />
      ) : null}

      {error ? (
        <div className="internet-invite__error" role="alert">
          <p>{error.message}</p>
          {error.retryAction === "bootstrap" ? (
            <button
              className="button"
              disabled={pending}
              onClick={() => void bootstrap()}
              type="button"
            >
              Повторить
            </button>
          ) : null}
          {error.retryAction === "bind" ? (
            <button
              className="button"
              disabled={pending}
              onClick={() => void startBinding()}
              type="button"
            >
              Повторить
            </button>
          ) : null}
          {error.retryAction === "create" ? (
            <button
              className="button"
              disabled={pending}
              onClick={() => void createRoomAndInvite()}
              type="button"
            >
              Повторить
            </button>
          ) : null}
        </div>
      ) : null}
    </InternetHostShell>
  );
}

function InternetHostEntry({ appOrigin }: { appOrigin: string }) {
  const abortRef = useRef<AbortController | null>(null);
  const challengeIdRef = useRef<string | null>(null);
  const roomIdempotencyKeyRef = useRef(createPublicRoomIdempotencyKey());
  const inviteIdempotencyKeyRef = useRef(createPublicInviteIdempotencyKey());
  const createdRoomRef = useRef<PublicRoomAccess | null>(null);
  const queryClient = useQueryClient();
  const accountQuery = useQuery({
    queryKey: INTERNET_ACCOUNT_QUERY_KEY,
    queryFn: ({ signal }) => getAccount(signal),
    retry: false,
    staleTime: 0,
  });

  const [flowStep, setFlowStep] = useState<Exclude<HostStep, "bootstrap"> | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [pending, setPending] = useState(false);
  const [challengeHint, setChallengeHint] = useState<string | null>(null);
  const [error, setError] = useState<HostError | null>(null);
  const [created, setCreated] = useState<CreatedInternetRoom | null>(null);
  const [hasCreatedRoom, setHasCreatedRoom] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");

  const bootstrapStep: HostStep =
    accountQuery.isPending || accountQuery.isFetching
      ? "bootstrap"
      : accountQuery.data
        ? "ready"
        : isAccountRequiredError(accountQuery.error)
          ? "email"
          : "error";
  const step = flowStep ?? bootstrapStep;
  const visibleError: HostError | null =
    error ??
    (flowStep === null && bootstrapStep === "error"
      ? {
          message: "Не удалось связаться с Internet-сервисом. Попробуйте ещё раз чуть позже.",
          retryAction: "bootstrap",
        }
      : null);
  const retryAction = visibleError?.retryAction ?? null;

  useEffect(() => () => abortRef.current?.abort(), []);

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

  async function bootstrapAccount() {
    setFlowStep(null);
    setError(null);
    await accountQuery.refetch();
  }

  function applyTemporaryError(retryAction: HostError["retryAction"]) {
    setFlowStep("error");
    setError({
      message: "Не удалось связаться с Internet-сервисом. Попробуйте ещё раз чуть позже.",
      retryAction,
    });
  }

  function applyCommandError(caught: unknown, retryAction: HostError["retryAction"]) {
    if (isAccountRequiredError(caught)) {
      setFlowStep("email");
      setError({
        message: "Сессия входа закончилась. Подтвердите email ещё раз.",
        retryAction: null,
      });
      return;
    }

    if (caught instanceof ApiProblemError && caught.problem.status === 429) {
      setFlowStep("error");
      setError({
        message: "Слишком много попыток. Подождите немного и попробуйте снова.",
        retryAction,
      });
      return;
    }

    if (caught instanceof ApiProblemError && caught.problem.code === "MEMBERSHIP_REQUIRED") {
      setFlowStep("error");
      setError({ message: "Internet-комната больше недоступна.", retryAction: null });
      return;
    }

    applyTemporaryError(retryAction);
  }

  async function requestChallenge() {
    const controller = beginRequest();
    try {
      const accepted = await requestEmailChallenge(email.trim(), controller.signal);
      challengeIdRef.current = accepted.challengeId;
      setChallengeHint(CHALLENGE_NEUTRAL_MESSAGE);
      setFlowStep("code");
    } catch (caught) {
      if (!controller.signal.aborted) {
        applyCommandError(caught, "email");
      }
    } finally {
      finishRequest(controller);
    }
  }

  function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void requestChallenge();
  }

  async function verifyChallenge() {
    const challengeId = challengeIdRef.current;
    if (!challengeId) {
      setFlowStep("email");
      return;
    }

    const controller = beginRequest();
    try {
      const profile = await verifyEmailChallenge(
        challengeId,
        { code: code.trim(), displayName: displayName.trim() },
        controller.signal,
      );
      challengeIdRef.current = null;
      setCode("");
      queryClient.setQueryData(INTERNET_ACCOUNT_QUERY_KEY, profile);
      setFlowStep("ready");
    } catch (caught) {
      if (controller.signal.aborted) {
        return;
      }
      if (isChallengeRejectedError(caught)) {
        setFlowStep("code");
        setError({
          message: "Код не принят. Проверьте ввод или получите новый код.",
          retryAction: "code",
          canRequestNewCode: true,
        });
        return;
      }
      applyCommandError(caught, "code");
    } finally {
      finishRequest(controller);
    }
  }

  function handleCodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void verifyChallenge();
  }

  function handleRequestNewCode() {
    challengeIdRef.current = null;
    setCode("");
    setChallengeHint(null);
    setError(null);
    setFlowStep("email");
  }

  async function createRoomAndInvite() {
    const controller = beginRequest();
    setFlowStep("creating");
    try {
      let access = createdRoomRef.current;
      if (!access) {
        access = await createPublicRoom(
          ROOM_EXPIRES_IN_MINUTES,
          roomIdempotencyKeyRef.current,
          controller.signal,
        );
        createdRoomRef.current = access;
        setHasCreatedRoom(true);
      }

      const invite = await createPublicRoomInvite(
        access.room.publicRoomId,
        {
          expiresInMinutes: INVITE_EXPIRES_IN_MINUTES,
          maxRedemptions: INVITE_MAX_REDEMPTIONS,
        },
        inviteIdempotencyKeyRef.current,
        controller.signal,
      );
      setCreated({
        access,
        inviteUrl: createInternetInviteUrl(appOrigin, invite.invitePath),
      });
      setFlowStep("created");
    } catch (caught) {
      if (controller.signal.aborted) {
        return;
      }
      if (isIdempotencyReplayUnavailableError(caught)) {
        inviteIdempotencyKeyRef.current = createPublicInviteIdempotencyKey();
        setFlowStep("error");
        setError({
          message: "Прежнюю ссылку нельзя восстановить. Создайте новое приглашение.",
          retryAction: "create",
        });
        return;
      }
      applyCommandError(caught, "create");
    } finally {
      finishRequest(controller);
    }
  }

  async function handleCopyInvite() {
    if (!created) {
      return;
    }
    try {
      await copyText(created.inviteUrl);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  }

  function handleRetry(action: Exclude<HostError["retryAction"], null>) {
    switch (action) {
      case "bootstrap":
        void bootstrapAccount();
        break;
      case "email":
        void requestChallenge();
        break;
      case "code":
        void verifyChallenge();
        break;
      case "bind":
        break;
      case "create":
        void createRoomAndInvite();
        break;
    }
  }

  return (
    <InternetHostShell title="Создать Internet-комнату">
      <p>
        Комната и приглашение создаются в Internet-сервисе. Фильм останется на вашем компьютере;
        подключение видео появится следующим отдельным шагом.
      </p>

      {step === "bootstrap" ? <p role="status">Проверяем вход…</p> : null}

      {step === "email" ? (
        <form className="internet-invite__form" onSubmit={handleEmailSubmit}>
          <label htmlFor="internet-host-email">Email</label>
          <input
            autoComplete="email"
            id="internet-host-email"
            inputMode="email"
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
          <label htmlFor="internet-host-code">Одноразовый код</label>
          <input
            autoComplete="one-time-code"
            id="internet-host-code"
            maxLength={12}
            minLength={6}
            onChange={(event) => setCode(event.target.value)}
            pattern="[A-Za-z0-9]+"
            required
            type="text"
            value={code}
          />
          <label htmlFor="internet-host-display-name">Ваше имя</label>
          <input
            autoComplete="nickname"
            id="internet-host-display-name"
            maxLength={64}
            minLength={1}
            onChange={(event) => setDisplayName(event.target.value)}
            required
            type="text"
            value={displayName}
          />
          <button className="button button--primary" disabled={pending} type="submit">
            Подтвердить
          </button>
        </form>
      ) : null}

      {step === "ready" ? (
        <div className="internet-host__ready">
          <p>
            Вход подтверждён{accountQuery.data ? `: ${accountQuery.data.displayName}` : ""}. Теперь
            можно создать приватную комнату и ссылку для близкого человека.
          </p>
          <button
            className="button button--primary"
            disabled={pending}
            onClick={() => void createRoomAndInvite()}
            type="button"
          >
            {hasCreatedRoom ? "Продолжить создание приглашения" : "Создать комнату"}
          </button>
        </div>
      ) : null}

      {step === "creating" ? <p role="status">Создаём комнату и приглашение…</p> : null}

      {step === "created" && created ? (
        <CreatedRoomResult
          created={created}
          copyStatus={copyStatus}
          onCopy={() => void handleCopyInvite()}
        />
      ) : null}

      {visibleError ? (
        <div className="internet-invite__error" role="alert">
          <p>{visibleError.message}</p>
          {retryAction && retryAction !== "bind" ? (
            <button
              className="button"
              disabled={pending}
              onClick={() => handleRetry(retryAction)}
              type="button"
            >
              Повторить
            </button>
          ) : null}
          {visibleError.canRequestNewCode ? (
            <button className="button" onClick={handleRequestNewCode} type="button">
              Получить новый код
            </button>
          ) : null}
        </div>
      ) : null}
    </InternetHostShell>
  );
}

function CreatedRoomResult({
  created,
  copyStatus,
  onCopy,
}: {
  created: CreatedInternetRoom;
  copyStatus: "idle" | "copied" | "error";
  onCopy: () => void;
}) {
  return (
    <div className="internet-host__result">
      <h2>Комната создана</h2>
      <p>Отправьте эту ссылку гостю. Она даёт доступ максимум трём людям.</p>
      <label htmlFor="internet-host-invite">Ссылка приглашения</label>
      <input id="internet-host-invite" readOnly type="text" value={created.inviteUrl} />
      <div className="internet-host__actions">
        <button className="button" onClick={onCopy} type="button">
          Скопировать ссылку
        </button>
        <Link
          className="button button--primary"
          to={`/internet/rooms/${created.access.room.publicRoomId}`}
        >
          Перейти к комнате
        </Link>
      </div>
      {copyStatus === "copied" ? <p role="status">Ссылка скопирована</p> : null}
      {copyStatus === "error" ? (
        <p className="internet-invite__error" role="alert">
          Не удалось скопировать ссылку. Выделите её вручную.
        </p>
      ) : null}
    </div>
  );
}

function InternetHostShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      className="internet-invite internet-invite--guest"
      aria-labelledby="internet-host-title"
    >
      <p className="eyebrow">Internet-комната</p>
      <h1 id="internet-host-title">{title}</h1>
      {children}
    </section>
  );
}
