# Backend

Spring Boot backend skeleton для WT-102.

## Стек

- Java 25 LTS.
- Spring Boot 4.1.x.
- Gradle Kotlin DSL через Gradle Wrapper репозитория.
- Spring Web MVC, Bean Validation, Spring Security и Actuator.
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

## Область WT-102

WT-102 создает только backend foundation: воспроизводимую сборку, health/version REST endpoints, validation dependency, stateless security baseline, actuator и тесты.

Вне области: rooms, participants, Redis, PostgreSQL, Flyway migrations, WebSocket state, LiveKit product tokens, chat, voice и persistence.

REST, WebSocket и error contracts находятся в [`../contracts`](../contracts/README.md). Новые product endpoints реализуются contract-first и не должны расходиться с OpenAPI/JSON Schema.

## Redis

Room state и idempotency records хранятся в Redis. Локальные defaults:

```text
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=watch_together_redis_dev_only
ROOM_TTL=4h
```

Создание комнаты требует работающий Redis. Полный локальный stack запускается командами `pnpm infra:up` и `pnpm infra:check`.
