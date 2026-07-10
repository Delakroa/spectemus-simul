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

WT-301 добавляет выдачу LiveKit product tokens по текущей room session. Backend подписывает JWT через `LIVEKIT_API_SECRET`, возвращает browser-facing `LIVEKIT_URL` и назначает grants по роли participant.

Вне текущей области: PostgreSQL product state, Flyway migrations, frontend media lifecycle, chat и voice.

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
```

Создание комнаты, восстановление snapshot, вход гостя, выдача LiveKit token, выход guest participant, закрытие комнаты, WebSocket snapshot и presence heartbeat требуют работающий Redis. Полная локальная среда запускается командами `pnpm infra:up` и `pnpm infra:check`.
