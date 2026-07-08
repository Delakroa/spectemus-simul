import { CircleCheck, Clapperboard, RefreshCw, Server, WifiOff } from "lucide-react";

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
  const { health, version, isPending, isError, refetch } = useSystemStatus();
  const isOnline = !isPending && !isError;

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
            <span className="watch-stage__label">Сеанс просмотра</span>
            <span className="watch-stage__state">Не начат</span>
          </div>
          <div className="watch-stage__empty">
            <span className="watch-stage__icon" aria-hidden="true">
              <Clapperboard size={34} />
            </span>
            <strong>Комната пока не выбрана</strong>
          </div>
          <div className="watch-stage__timeline" aria-hidden="true">
            <span />
          </div>
        </div>
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
