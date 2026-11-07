# SPS-721 — отключение участника LiveKit после revoke

## Цель

После `POST /api/v2/public-rooms/{publicRoomId}/members/{accountId}/revoke`
сохранить revoke в PostgreSQL и отключить уже подключённого гостя от public
LiveKit-комнаты через `RoomService.RemoveParticipant`. LAN `/api/v1` не
меняется. Internet mode по умолчанию выключен.

## Security boundary

1. Проверка account session и полномочий OWNER.
2. Persist revoke membership (главный результат; не откатывается).
3. Opaque `room` / `identity` через `PublicAccessSecrets`.
4. `RemoveParticipant` при `PUBLIC_LIVEKIT_ENABLED=true` — **до** audit, чтобы сбой
   записи audit не оставлял гостя подключённым.
5. Audit `PUBLIC_MEMBER_REVOKED`.
6. `204` при успехе или валидном Twirp `not_found` (HTTP 404 + ровно один
   JSON-объект с `code == "not_found"` через `tools.jackson` ObjectMapper с
   `FAIL_ON_TRAILING_TOKENS`). HTML/пустой/обрезанный/битый JSON, данные после
   закрывающего объекта и `not_found` под другим статусом → fail-closed `503`.

При недоступности Admin API / timeout / неожиданном ответе:

- membership остаётся revoked;
- `503 PUBLIC_LIVEKIT_DISCONNECT_FAILED` (retryable);
- повторный revoke снова вызывает Admin API;
- в ответе нет admin URL, JWT, raw upstream body и секретов.

Admin API не вызывается при: невалидной session, не-OWNER, попытке отозвать
OWNER, revoke invite, выключенном public LiveKit.

## Конфигурация

| Параметр / env                    | Назначение                                    |
| --------------------------------- | --------------------------------------------- |
| `PUBLIC_LIVEKIT_ENABLED`          | Switch token + admin client                   |
| `PUBLIC_LIVEKIT_RTC_URL`          | Browser `wss://`                              |
| `PUBLIC_LIVEKIT_API_URL`          | RoomService `https://`, без loopback          |
| `PUBLIC_LIVEKIT_API_KEY` / SECRET | Не LAN/default credentials                    |
| `PUBLIC_LIVEKIT_ADMIN_TOKEN_TTL`  | Короткий admin JWT (default 1m, max 5m)       |
| `PUBLIC_LIVEKIT_ADMIN_TIMEOUT`    | Connect/request timeout (default 3s, max 15s) |

Реальные credentials в git не добавляются.

## Admin JWT

Bearer JWT: `roomAdmin=true`, `room=<opaque room name>`, без `roomJoin`.
`sub=public-room-admin`. Нет account UUID, email, invite token, session cookie.

## Ограничение self-hosted LiveKit

`RemoveParticipant` отключает активного participant. Он **не** отзывает уже
выданный media JWT на self-hosted LiveKit. После revoke:

- backend больше не выдаёт новый token (membership check);
- подключённый participant отключается при успешном Admin API;
- старый JWT теоретически может использоваться до своего `expiresAt`;
- TTL media token ≤ 5m и не превышает `room.expiresAt`.

Закрытие in-flight окна, которое LiveKit технически не гарантирует, в этот
тикет не входит и не обещается.

## Проверки

- `git diff --check` — без замечаний
- `./gradlew :backend:test --no-daemon` — BUILD SUCCESSFUL, 175 тестов
  (в т.ч. truncated/`garbage`/missing-comma 404 → 503; валидный Twirp
  `not_found` → 204)
- `pnpm contracts:check` — ok

## Откат

`PUBLIC_LIVEKIT_ENABLED=false` убирает admin client; revoke membership в БД
сохраняет прежнее поведение без disconnect. Полный откат тикета возвращает
revoke endpoint без 503 disconnect semantics.

## Следующий gate

Публичные WSS/TURN, диагностика сети, privacy-safe telemetry. Internet mode
остаётся выключенным до staging gate.
