# WT-501 Backend tests

## Статус

Завершено.

## Цель

Укрепить backend-покрытие по семи областям WT-501: room state, permissions, TTL, concurrency, Redis, token, WebSocket. Подход — аудит существующего покрытия и закрытие реальных пробелов, без дублирования уже покрытого.

## Аудит покрытия

На момент тикета backend уже покрыт 79 тестами. Отображение областей на существующие тесты:

- **room state** — `RoomCloseServiceTest` (CREATED→CLOSED, идемпотентность), `RedisRoomLifecycleStoreTest` (CLOSED / EXPIRED / already-closed), `RoomWebSocketIntegrationTest` (HOST_DISCONNECTED→recover, room.closed), `RoomRestoreServiceTest`. Статусы `READY/PLAYING/PAUSED` кодом не выставляются — переходов для проверки нет.
- **permissions** — `RoomCloseServiceTest` (invalid session / access denied), `LiveKitTokenServiceTest` (HOST vs GUEST grants, session не из комнаты), `RoomWebSocketIntegrationTest` (rejectsMissingInvalidAndUnavailableSessions + новый тест спуфинга participantId), `RoomControllerTest` / `RoomJoinControllerTest`.
- **TTL** — `RoomCreationServiceTest` (room / idempotency TTL), presence TTL и expiry в `RedisRoomLifecycleStoreTest`, token TTL (`exp`/`expiresAt`) в `LiveKitTokenServiceTest`.
- **concurrency** — `RoomCreationServiceTest` (idempotency replay, room-id collision retry), `RoomJoinServiceTest` (replay participant, room full) + новые WebSocket-тесты (duplicate connection, stale connection).
- **Redis** — `RedisRoomCreationStoreTest`, `RedisRoomJoinStoreTest`, `RedisRoomLifecycleStoreTest`, `RedisRoomRealtimeStoreTest` (result parsing, отсутствие утечки room state, обратная совместимость).
- **token** — `LiveKitTokenServiceTest` (claims, grants, TTL, signature, session/room rejection).
- **WebSocket** — `RoomWebSocketIntegrationTest` (snapshot, heartbeat, presence, chat, host disconnect/reconnect, room closed) + `@DirtiesContext(AFTER_EACH_TEST_METHOD)` для изоляции.

## Закрытые пробелы

Добавлены тесты в `RoomWebSocketIntegrationTest` на непокрытое поведение WebSocket-хендлера (concurrency + permissions):

- `replacesPreviousConnectionWhenSameParticipantReconnects` — повторное подключение того же участника закрывает предыдущую сессию (код 1000), новейшая остаётся живой.
- `closesStaleConnectionOnHeartbeatWithPolicyViolation` — heartbeat от вытесненного соединения (`STALE_CONNECTION`) закрывается с `POLICY_VIOLATION` (1008).
- `closesHeartbeatWhoseParticipantIdDoesNotMatchSessionWithBadData` — heartbeat с чужим `participantId` (не совпадает с сессией) закрывается с `BAD_DATA` (1007) — защита от подмены identity.

## Проверка

```bash
./gradlew :backend:test
pnpm check:ci
```

Локально в этой задаче проверено:

- `./gradlew :backend:test` и `:backend:build --rerun-tasks` — зелёные, детерминированно (несколько форс-прогонов); `RoomWebSocketIntegrationTest` — 19 тестов.
- Новые тесты покрывают duplicate-connection replacement, stale-connection guard и identity-mismatch на heartbeat.

## Известные ограничения

- `RedisRoom*StoreTest` мокируют `StringRedisTemplate`, поэтому Lua-скрипты (атомарные read-modify-write) проверяются на уровне Java-логики стора, но не исполняются на реальном Redis. Полная проверка атомарности/ветвлений Lua требует embedded Redis или Testcontainers — отдельный инфраструктурный шаг, вне области WT-501.
- Многопользовательские сценарии «в сборе» (host + гости, реальный LiveKit) остаются за WT-503 (Multi-user E2E).
- Нагрузочные / гоночные проверки под параллельной нагрузкой — за WT-504 / WT-507.
