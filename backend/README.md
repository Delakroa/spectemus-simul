# Backend

Spring Boot backend Watch Together.

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
- `POST /api/v1/rooms/{roomId}/join`

## Область

WT-102 создал backend foundation: воспроизводимую сборку, health/version REST endpoints, validation dependency, stateless security baseline, actuator и тесты.

WT-201 и WT-202 добавили создание комнаты и вход гостя с Redis persistence, TTL, idempotency, session identity и ограничением вместимости.

Вне текущей области: PostgreSQL product state, Flyway migrations, WebSocket state, LiveKit product tokens, chat и voice.

REST, WebSocket и error contracts находятся в [`../contracts`](../contracts/README.md). Новые product endpoints реализуются contract-first и не должны расходиться с OpenAPI/JSON Schema.

## Redis

Room state, participant sessions и idempotency records хранятся в Redis. Локальные defaults:

```text
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=watch_together_redis_dev_only
ROOM_TTL=4h
```

Создание комнаты и вход гостя требуют работающий Redis. Полный локальный stack запускается командами `pnpm infra:up` и `pnpm infra:check`.
