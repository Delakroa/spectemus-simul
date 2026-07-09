# WT-204 Presence heartbeat

## Статус

Завершено.

## Цель

Сделать backend источником правды для presence в комнате: WebSocket connect, heartbeat и disconnect должны обновлять `online` в Redis room state и рассылать участникам события `participant.online` / `participant.offline`.

## Поведение

- При WebSocket connect backend повторно проверяет room/session и создает новый `connectionId`.
- Последнее соединение одного participant считается актуальным; предыдущее соединение закрывается.
- Redis presence key хранит актуальный `connectionId` с TTL `watch-together.websocket.presence-ttl`.
- `participant.heartbeat` продлевает Redis presence TTL и подтверждает, что соединение остается актуальным.
- При закрытии актуального соединения participant переводится в `online=false`.
- Если закрывается старое соединение, уже замененное reconnect, room state не меняется.
- Изменение `online` увеличивает `roomVersion` и обновляет `updatedAt`.
- Все активные WebSocket-сессии комнаты получают `participant.online` или `participant.offline`.
- Reconnect первым сообщением получает свежий `room.snapshot` с актуальным presence.

## Client command

Heartbeat использует уже зафиксированный client event contract:

```json
{
  "schemaVersion": 1,
  "eventId": "d3072590-9131-4abc-9012-8fa6e42f21d3",
  "type": "participant.heartbeat",
  "roomId": "AbCdEfGhIjKlMnOpQrStUv",
  "participantId": "8e7d79a8-a49f-48cc-a409-f07890dd3218",
  "expectedRoomVersion": 42,
  "occurredAt": "2026-07-09T07:30:00Z",
  "payload": {
    "sentAt": "2026-07-09T07:30:00Z"
  }
}
```

## Server events

Presence fan-out:

```json
{
  "schemaVersion": 1,
  "eventId": "e3fef1e4-270e-4c41-9fd1-4f23843068b7",
  "type": "participant.online",
  "roomId": "AbCdEfGhIjKlMnOpQrStUv",
  "participantId": "8e7d79a8-a49f-48cc-a409-f07890dd3218",
  "roomVersion": 43,
  "occurredAt": "2026-07-09T07:30:05Z",
  "payload": {
    "participantId": "8e7d79a8-a49f-48cc-a409-f07890dd3218",
    "online": true,
    "updatedAt": "2026-07-09T07:30:05Z"
  }
}
```

`participant.offline` использует тот же payload, но `online=false`.

## Проверка

```bash
pnpm contracts:check
pnpm backend:test
pnpm infra:check
pnpm check
```

Финальная проверка:

- `pnpm check` прошёл полностью;
- backend: 41 тест;
- frontend: 7 тестов;
- PoC: 13 тестов;
- `pnpm security:audit`: production-уязвимости не обнаружены;
- Docker Compose: все пять сервисов healthy;
- `infra:check`: REST lifecycle, WebSocket snapshot/reconnect, heartbeat, presence online/offline fan-out и unknown command прошли через Nginx и Redis.

## Известные ограничения

- Proactive cleanup после backend crash ограничен Redis TTL и последующей state reconciliation; отдельный room sweeper не входит в WT-204.
- `participant.joined`, `participant.left`, close/expiry events относятся к следующим room lifecycle тикетам.
- Media controls, chat и voice client-команды пока не реализуются.
- Browser reconnect policy и UI-индикация presence относятся к frontend-тикетам.
