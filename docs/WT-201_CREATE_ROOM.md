# WT-201 Создание комнаты

## Статус

Завершено.

## Цель

Реализовать создание приватной комнаты с криптографически случайными идентификаторами, отдельными credentials, TTL и атомарной idempotency.

## REST endpoint

```http
POST /api/v1/rooms
Idempotency-Key: create-room-unique-key
Content-Type: application/json

{
  "hostDisplayName": "Host"
}
```

Успешный ответ:

- HTTP `201 Created`;
- `Location: /api/v1/rooms/{roomId}`;
- HttpOnly cookie `wt_session`;
- room snapshot;
- отдельный `hostSecret`;
- guest `invitePath` без секрета.

## Реализовано

- Public room ID: 16 random bytes, Base64 URL без padding, 22 символа.
- Host secret: 32 random bytes, Base64 URL без padding, 43 символа.
- Session credential: отдельные 32 random bytes.
- Host secret и session credential хранятся в room state только как SHA-256 hashes.
- Room и idempotency record хранятся в Redis с одинаковым TTL.
- Redis Lua operation атомарно проверяет idempotency key, room ID collision и сохраняет обе записи.
- Повтор с тем же key и payload возвращает исходный room, host secret и session.
- Тот же key с другим payload возвращает `409 IDEMPOTENCY_CONFLICT`.
- Collision room ID приводит к безопасной повторной генерации.
- Ошибки соответствуют `application/problem+json`.
- Каждый HTTP response получает `X-Correlation-ID`.
- Input validation ограничивает host name и idempotency key.
- Redis входит в backend health для реальной среды.

## Конфигурация

```text
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=watch_together_redis_dev_only
ROOM_TTL=4h
SESSION_COOKIE_SECURE=false
```

В production `SESSION_COOKIE_SECURE` должен быть `true`, а Redis credentials должны поступать из secret storage.

## Проверка

```bash
pnpm backend:test
pnpm contracts:check
pnpm check
pnpm infra:up
pnpm infra:check
```

`infra:check` создаёт комнату через reverse proxy и повторяет запрос с тем же `Idempotency-Key`.

Финальная проверка:

- `pnpm check` прошёл полностью;
- backend: 19 тестов;
- frontend: 7 тестов;
- PoC: 13 тестов;
- `pnpm security:audit`: уязвимости не обнаружены;
- OSV Scanner: уязвимости не обнаружены;
- Docker Compose: все пять сервисов healthy;
- `infra:check`: создание комнаты и idempotent replay через reverse proxy прошли.

## Известные ограничения

- Join, room snapshot endpoint и close относятся к WT-202/203/205.
- Rate limiting create endpoint будет добавлен security hardening тикетом.
- Для idempotent replay Redis временно хранит response credentials до истечения TTL. Production Redis должен быть изолирован, а application-level encryption относится к WT-505.
- Session cookie не используется для авторизации до реализации WT-202.
- Room expiry пока обеспечивается Redis TTL без отдельного `room.closed` event.
