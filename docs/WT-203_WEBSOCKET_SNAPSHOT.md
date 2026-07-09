# WT-203 WebSocket и snapshot

## Статус

Завершено.

## Цель

Добавить авторизованный room WebSocket channel, который при каждом connect и reconnect первым сообщением возвращает актуальный authoritative snapshot комнаты.

## WebSocket endpoint

```text
ws://host/api/v1/rooms/{roomId}/events
```

Handshake использует только same-origin HttpOnly cookie `wt_session`. Session credential в query string запрещён.

## Handshake

- Некорректный query отклоняется с HTTP `400`.
- Отсутствующая или недействительная session отклоняется с HTTP `401`.
- Отсутствующая, закрытая или истёкшая комната отклоняется с HTTP `404`.
- Room ID и session проверяются по Redis state до WebSocket upgrade.
- Перед отправкой snapshot session и room повторно проверяются, чтобы закрыть race между handshake и open.
- Same-origin policy обеспечивается Spring WebSocket registration.
- Nginx передаёт внешний Host вместе с портом, поэтому Origin корректно проверяется за reverse proxy.

## Snapshot event

Первое сообщение каждого соединения соответствует `websocket-server-event.schema.json`:

```json
{
  "schemaVersion": 1,
  "eventId": "3877f87a-aaf2-4ea7-94cc-e5ceb74f38a7",
  "type": "room.snapshot",
  "roomId": "AbCdEfGhIjKlMnOpQrStUv",
  "participantId": null,
  "roomVersion": 3,
  "occurredAt": "2026-07-09T10:00:00Z",
  "payload": {}
}
```

- `eventId` создаётся заново для каждого snapshot.
- `roomVersion` envelope совпадает с `payload.roomVersion`.
- `occurredAt` формируется server clock в UTC.
- Payload читается из Redis после установления соединения.
- Reconnect всегда получает новый event с текущей room version.

## Transport policy

- Принимаются только UTF-8 JSON text messages.
- Максимальный размер text/binary message: 16 KiB.
- Неизвестная или пока не поддерживаемая client-команда закрывает соединение кодом `1007`.
- Binary message закрывает соединение кодом `1003`.
- Oversized message закрывает соединение кодом `1009`.
- Неизвестный server event с валидным envelope остаётся обратно совместимым и безопасно игнорируется клиентом согласно контракту.

## Проверка

```bash
pnpm backend:test
pnpm contracts:check
pnpm check
pnpm infra:up
pnpm infra:check
```

Integration tests поднимают настоящий embedded Tomcat и проверяют handshake, snapshot envelope, reconnect, HTTP-отказы и unknown client command.

`infra:check` подключается через Nginx gateway с guest cookie и проверяет snapshot, reconnect и закрытие неизвестной команды.

Финальная проверка:

- `pnpm check` прошёл полностью;
- backend: 37 тестов;
- frontend: 7 тестов;
- PoC: 13 тестов;
- `pnpm security:audit`: production-уязвимости не обнаружены;
- Docker Compose: все пять сервисов healthy;
- `infra:check`: REST lifecycle, WebSocket snapshot, reconnect и unknown command прошли через Nginx и Redis;
- отдельная локальная OSV-команда в проекте не заведена; обязательный OSV PR scan и dependency review выполняются GitHub Actions до merge.

## Известные ограничения

- Heartbeat, online/offline и duplicate connection policy реализованы в WT-204.
- `participant.left` реализован в WT-206; отдельный `participant.joined` event пока не реализуется.
- Close и expiry events реализованы в WT-205.
- Media control, chat и voice client-команды пока отклоняются.
- Browser reconnect policy и UI относятся к последующим frontend-тикетам.
