# Backend

Spring Boot бэкенд Watch Together.

## Стек

- Java 25 LTS.
- Spring Boot 4.1.x.
- Gradle Kotlin DSL через Gradle Wrapper репозитория.
- Spring Web MVC, Spring WebSocket, Bean Validation, Spring Security и Actuator.
- Modular monolith packages для rooms, participants, access, realtime, media-session, chat и observability.

## Команды

Из корня репозитория:

```bash
pnpm backend:test
pnpm backend:build
pnpm backend:bootRun
```

Прямые Gradle-команды:

```bash
./gradlew :backend:test
./gradlew :backend:build
./gradlew :backend:bootRun
```

## Эндпоинты

- `GET /api/v1/health`
- `GET /api/v1/version`
- `GET /actuator/health`
- `POST /api/v1/rooms`
- `GET /api/v1/rooms/{roomId}`
- `POST /api/v1/rooms/{roomId}/join`
- `POST /api/v1/rooms/{roomId}/leave`
- `POST /api/v1/rooms/{roomId}/livekit-token`
- `POST /api/v1/rooms/{roomId}/close`
- `GET /api/v1/rooms/{roomId}/events` с WebSocket upgrade

## Область

WT-102 создал backend foundation: воспроизводимую сборку, REST endpoints `health/version`, validation dependency, stateless security baseline, actuator и тесты.

WT-201, WT-202, WT-203, WT-204, WT-205, WT-206, WT-207 и WT-209 добавили создание комнаты, вход гостя, восстановление snapshot по session cookie, авторизованный WebSocket snapshot, backend-owned presence heartbeat, `participant.joined`, закрытие комнаты host-ом и явный выход guest participant. Эти сценарии используют Redis persistence, TTL, idempotency и session identity.

WT-301 добавляет выдачу LiveKit product tokens по текущей room session. Backend подписывает JWT через `LIVEKIT_API_SECRET`, возвращает browser-facing `LIVEKIT_URL` и назначает grants по роли participant. WT-302-WT-306 используют эти tokens для product media pipeline на frontend; backend остаётся authority для room/session access, а медиабайты не загружаются на сервер.

WT-402 добавляет backend lifecycle для host reconnect: `HOST_DISCONNECTED`, события `host.disconnected` / `host.reconnected`, grace period `watch-together.websocket.host-reconnect-grace` и закрытие комнаты с reason `HOST_TIMEOUT`, если host не вернулся.

WT-403 добавляет текстовый чат поверх room WebSocket: server-side validation, per-participant rate limit, `chat.message` broadcast и `error` events для `VALIDATION_FAILED` / `RATE_LIMITED`.

WT-404 добавляет voice chat на LiveKit media plane. Backend выдаёт guest token с `canPublish=true` для публикации microphone track; `canPublishData` для guest остаётся `false`, а playback-state data channel остаётся host-only.

Вне текущей области: PostgreSQL product state, Flyway migrations, persisted chat history, distributed grace timers и distributed chat rate limit.

REST, WebSocket и error contracts находятся в [`../contracts`](../contracts/README.md). Новые product endpoints реализуются contract-first и не должны расходиться с OpenAPI/JSON Schema.

## Redis

Room state, participant sessions и idempotency records хранятся в Redis. Локальные значения по умолчанию:

```text
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=watch_together_redis_dev_only
ROOM_TTL=4h
ROOM_CLEANUP_GRACE=5m
WEBSOCKET_PRESENCE_TTL=30s
LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecretdevsecretdevsecretdevsecret
LIVEKIT_TOKEN_TTL=10m
WEBSOCKET_CHAT_RATE_LIMIT=5
WEBSOCKET_CHAT_RATE_WINDOW=5s
WEBSOCKET_HOST_RECONNECT_GRACE=60s
```

Создание комнаты, восстановление snapshot, вход гостя, выдача LiveKit token, выход guest participant, закрытие комнаты, host reconnect, WebSocket snapshot, presence heartbeat и chat messaging требуют работающий Redis для room/session state. Chat rate limit сейчас in-memory и per-instance. Полная локальная среда запускается командами `pnpm infra:up` и `pnpm infra:check`.
