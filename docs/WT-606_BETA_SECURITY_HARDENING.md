# WT-606 Beta security / rate-limit hardening

## Статус

Сделано (repo-side).

## Цель

Подготовить публично доступный (пусть и invite-only) beta-стенд к реальному трафику: ограничить абьюз и неконтролируемую стоимость LiveKit через распределённые rate limits, сузить CSP `connect-src` под фиксированный beta-host, зафиксировать HSTS и подтвердить, что actuator/metrics не открыты наружу. Это safety-gate перед WT-603 (beta evidence run).

## Поведение

### Rate limits (Redis-backed)

- Лимиты применяются на публичные мутирующие endpoints: `POST /api/v1/rooms` (create), `.../join`, `.../livekit-token`, `/api/v1/feedback`, `/api/v1/telemetry`.
- Ключ — клиентский IP (первый hop `X-Forwarded-For`, который выставляет gateway; fallback — socket-адрес). Окно фиксированное, счётчик и TTL ставятся атомарно одним Lua-скриптом в Redis, поэтому бюджет общий на все инстансы backend (в отличие от in-memory chat-лимитера WT-403).
- Превышение возвращает `429 RATE_LIMITED` (`retryable: true`) с заголовком `Retry-After` и НЕ роняет соединение. Ответ — стандартный ProblemDetails через `ApiExceptionHandler`.
- Дефолтные бюджеты (на IP): create 10/мин, join 20/мин, livekit-token 30/мин, feedback 10/мин, telemetry 60/мин. Настраиваются через `watch-together.rate-limit.*` (env `RATE_LIMIT_*`). Вся фича выключается флагом `RATE_LIMIT_ENABLED=false` (по умолчанию включена — secure by default).
- Метрика `wt.ratelimit.rejected{bucket}` (privacy-safe: только счётчик + bucket-тег) на том же prometheus-surface, что WT-506/604.

### CSP / HSTS

- `security-headers.conf` теперь рендерится из шаблона entrypoint-ом nginx (`envsubst`). `connect-src` управляется переменной `WT_CSP_CONNECT_SRC`: по умолчанию `'self' ws: wss:` для dev, для beta её сужают до фиксированного host (например `'self' wss://livekit.beta.example`) без пересборки образа.
- Добавлен `Strict-Transport-Security` (`max-age=63072000; includeSubDomains`). На plain HTTP он инертен, вступает в силу, когда beta-gateway терминирует TLS.

### Actuator / gateway access

- `metrics` и `prometheus` остаются за Spring Security (`denyAll` для всего, что не в permitAll); публичны только `health`/`info`. Это зафиксировано тестом (`ActuatorHealthEndpointTest`: `/actuator/metrics` и `/actuator/prometheus` → 401/403).

## Реализация

- `backend/.../ratelimit/RateLimiter.java`, `RateLimitDecision.java`, `RedisRateLimiter.java` — интерфейс + Redis Lua fixed-window (INCR + PEXPIRE, возвращает остаток TTL при превышении).
- `backend/.../ratelimit/RateLimitProperties.java` — `@ConfigurationProperties("watch-together.rate-limit")` с бюджетами по bucket и флагом enabled.
- `backend/.../ratelimit/RateLimitInterceptor.java`, `RateLimitConfiguration.java` — `HandlerInterceptor` на POST защищаемых путей, бросает `ApiException.rateLimited(...)`, выставляет `Retry-After`, инкрементит `wt.ratelimit.rejected`.
- `backend/.../api/ApiException.java` — фабрика `rateLimited(...)` (`429`, `RATE_LIMITED`, retryable).
- `backend/src/main/resources/application.yml` — блок `watch-together.rate-limit`.
- `infra/nginx/security-headers.conf.template` (+ `frontend/Dockerfile`) — envsubst-шаблон с `${WT_CSP_CONNECT_SRC}` и HSTS; старый статический `security-headers.conf` удалён.
- Тесты: `RedisRateLimiterTest` (интерпретация результата Lua), `RateLimitInterceptorTest` (allow / non-POST skip / 429 + Retry-After + метрика / извлечение client IP), `ActuatorHealthEndpointTest` (metrics/prometheus закрыты).

## Проверка

```bash
pnpm contracts:check
pnpm backend:test
pnpm infra:up && pnpm infra:check && pnpm beta:smoke
```

Локально в этой задаче проверено:

- backend `RedisRateLimiterTest`, `RateLimitInterceptorTest`, `ActuatorHealthEndpointTest` и полный `:backend:build` прошли.
- После пересборки backend+gateway `infra:check` и `beta:smoke` прошли (нормальный трафик не упирается в лимиты); ручной burst сверх лимита вернул `429 RATE_LIMITED` с `Retry-After`; CSP-заголовок через gateway содержит подставленный `connect-src` и `Strict-Transport-Security`.

## Известные ограничения

- Окно фиксированное (не sliding): на стыке двух окон теоретически возможен всплеск до 2× лимита. Для beta приемлемо.
- Лимит по IP: клиенты за общим NAT делят бюджет; доверие к `X-Forwarded-For` корректно только пока backend не выставлен в интернет напрямую (доступ только через gateway).
- WS chat rate limiter (WT-403) остаётся in-memory per-instance; при желании его можно перевести на этот же Redis-лимитер отдельным тикетом.
- `WT_CSP_CONNECT_SRC` для beta нужно задать реальным host(ами) LiveKit/gateway на деплое; дефолт остаётся dev-разрешающим.
