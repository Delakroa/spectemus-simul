# WT-205 Room close и expiry

## Статус

Завершено.

## Цель

Завершить базовый room lifecycle: host может закрыть комнату, backend рассылает `room.closed`, активные WebSocket-сессии закрываются, а истекшие комнаты становятся недоступны после логического `expiresAt`.

## REST close

Endpoint:

```text
POST /api/v1/rooms/{roomId}/close
```

Требования:

- browser session передается только через HttpOnly cookie `wt_session`;
- host secret передается в header `X-Host-Secret`;
- закрыть комнату может только host participant с валидным session credential и host secret;
- успешный ответ: `204 No Content`, `Cache-Control: no-store`;
- повторное закрытие уже закрытой комнаты с валидными host credentials идемпотентно возвращает `204`;
- отсутствующая, истекшая или недоступная комната возвращает `404 ROOM_UNAVAILABLE`;
- не-host session или неверный host secret возвращает `403 ACCESS_DENIED`;
- отсутствующая или невалидная session возвращает `401 AUTHENTICATION_REQUIRED`.

## Room state

При закрытии комнаты backend атомарно в Redis:

- переводит `status` в `CLOSED`;
- переводит всех participants в `online=false`;
- увеличивает `roomVersion`;
- обновляет `updatedAt`;
- удаляет active presence keys комнаты;
- сохраняет room state с текущим Redis TTL.

Логическая expiry отделена от физического удаления ключа:

- `expiresAt` остается product boundary;
- после `expiresAt` join и WebSocket connect недоступны;
- Redis room key живет еще `watch-together.rooms.cleanup-grace`, чтобы backend успел выполнить cleanup и отправить `room.closed` reason `EXPIRED` активным WebSocket-сессиям.

## WebSocket

Активные WebSocket-сессии комнаты получают:

```json
{
  "schemaVersion": 1,
  "eventId": "a4394a01-d223-4849-8e87-73017750d0c8",
  "type": "room.closed",
  "roomId": "AbCdEfGhIjKlMnOpQrStUv",
  "participantId": null,
  "roomVersion": 45,
  "occurredAt": "2026-07-09T07:31:00Z",
  "payload": {
    "reason": "HOST_CLOSED",
    "closedAt": "2026-07-09T07:31:00Z"
  }
}
```

После отправки `room.closed` backend закрывает WebSocket-сессии штатным close code `1000`.

## Проверка

```bash
pnpm contracts:check
pnpm backend:test
pnpm infra:check
pnpm check
```

Финальная проверка:

- `pnpm check` прошёл полностью;
- backend: 49 тестов;
- frontend: 7 тестов;
- PoC: 13 тестов;
- `pnpm security:audit`: production-уязвимости не обнаружены;
- Docker Compose: все пять сервисов healthy;
- `infra:check`: REST lifecycle, WebSocket snapshot/reconnect, heartbeat, presence fan-out, unknown command, close endpoint и `room.closed` прошли через Nginx и Redis.

## Известные ограничения

- Полноценный distributed sweeper для комнат без активных WebSocket-сессий не входит в WT-205: такие комнаты очищаются Redis TTL после cleanup grace.
- `participant.left` как явная пользовательская команда выхода относится к следующему lifecycle тикету.
- Media controls, chat, voice и LiveKit product token lifecycle пока не реализуются.
