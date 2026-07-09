# Backend

Spring Boot backend Watch Together.

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
- `POST /api/v1/rooms/{roomId}/join`
- `GET /api/v1/rooms/{roomId}/events` с WebSocket upgrade

## Область

WT-102 создал backend foundation: воспроизводимую сборку, health/version REST endpoints, validation dependency, stateless security baseline, actuator и тесты.

WT-201, WT-202, WT-203 и WT-204 добавили создание комнаты, вход гостя, авторизованный WebSocket snapshot и backend-owned presence heartbeat с Redis persistence, TTL, idempotency и session identity.

Вне текущей области: PostgreSQL product state, Flyway migrations, LiveKit product tokens, chat и voice.

REST, WebSocket и error contracts находятся в [`../contracts`](../contracts/README.md). Новые product endpoints реализуются contract-first и не должны расходиться с OpenAPI/JSON Schema.

## Redis

Room state, participant sessions и idempotency records хранятся в Redis. Локальные defaults:

```text
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=watch_together_redis_dev_only
ROOM_TTL=4h
WEBSOCKET_PRESENCE_TTL=30s
```

Создание комнаты, вход гостя, WebSocket snapshot и presence heartbeat требуют работающий Redis. Полный локальный stack запускается командами `pnpm infra:up` и `pnpm infra:check`.
