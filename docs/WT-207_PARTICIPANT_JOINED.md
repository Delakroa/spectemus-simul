# WT-207 Participant joined

## Статус

Завершено.

## Цель

Добавить realtime-событие `participant.joined`: когда новый guest participant успешно входит в комнату через REST `join`, все активные WebSocket-сессии комнаты должны получить событие о новом участнике.

## Поведение

- `POST /api/v1/rooms/{roomId}/join` остаётся REST-командой входа и возвращает participant + room snapshot.
- Если Redis join operation вернула `JOINED`, backend публикует `participant.joined`.
- Если join является replay существующей session cookie, событие не публикуется повторно.
- Событие отправляется только активным WebSocket-сессиям комнаты.
- Сессии не закрываются: новый участник подключается к WebSocket отдельно и первым сообщением получает обычный `room.snapshot`.

## WebSocket

Активные WebSocket-сессии комнаты получают:

```json
{
  "schemaVersion": 1,
  "eventId": "37adbb9e-2ee2-4590-864d-84f8a9b23b3d",
  "type": "participant.joined",
  "roomId": "AbCdEfGhIjKlMnOpQrStUv",
  "participantId": "8e7d79a8-a49f-48cc-a409-f07890dd3218",
  "roomVersion": 43,
  "occurredAt": "2026-07-09T07:30:05Z",
  "payload": {
    "participantId": "8e7d79a8-a49f-48cc-a409-f07890dd3218",
    "displayName": "Guest",
    "role": "GUEST",
    "online": true,
    "joinedAt": "2026-07-09T07:30:05Z"
  }
}
```

Payload соответствует `Participant` из `common.schema.json`.

## Проверка

```bash
pnpm contracts:check
pnpm backend:test
pnpm infra:check
pnpm check
pnpm security:audit
```

Финальная проверка:

- `pnpm check` прошёл полностью;
- backend: 57 тестов;
- frontend: 7 тестов;
- PoC: 13 тестов;
- `pnpm security:audit`: production-уязвимости не обнаружены;
- Docker Compose: все пять сервисов healthy;
- `infra:check`: REST lifecycle, `participant.joined`, WebSocket snapshot/reconnect, heartbeat, presence fan-out, unknown command, explicit leave, `participant.left`, capacity after leave, close endpoint и `room.closed` прошли через Nginx и Redis.

## Известные ограничения

- `participant.joined` описывает вход в room membership, а не WebSocket connect. Online/offline presence остаётся областью WT-204.
- Frontend-обработка `participant.joined` подключена в WT-208.
- Replay по существующей session cookie намеренно не создаёт повторный `participant.joined`.
