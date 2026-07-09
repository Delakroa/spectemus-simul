# WT-206 Participant leave

## Статус

Завершено.

## Цель

Добавить явный выход guest participant из комнаты: backend должен атомарно удалить participant из room state, освободить место в комнате, разослать `participant.left` и закрыть WebSocket-сессии уходящего участника.

## REST endpoint

Команда выхода:

```text
POST /api/v1/rooms/{roomId}/leave
```

Требования:

- browser session передаётся только через HttpOnly cookie `wt_session`;
- успешный ответ: `204 No Content`, `Cache-Control: no-store`;
- выйти через `leave` может только guest participant;
- host не выходит через `leave`, а закрывает комнату через `POST /api/v1/rooms/{roomId}/close`;
- отсутствующая, закрытая, истёкшая или недоступная комната возвращает `404 ROOM_UNAVAILABLE`;
- отсутствующая, невалидная или уже удалённая session возвращает `401 AUTHENTICATION_REQUIRED`;
- попытка host выйти через `leave` возвращает `403 ACCESS_DENIED`.

## Состояние комнаты

При успешном выходе backend атомарно в Redis:

- находит participant по hash от `wt_session`;
- запрещает удаление host participant;
- удаляет guest participant из `participants`;
- увеличивает `roomVersion`;
- обновляет `updatedAt`;
- удаляет active presence key участника;
- сохраняет room state с текущим Redis TTL.

Удаление участника освобождает capacity комнаты: после `leave` новый guest может присоединиться, если остальные ограничения комнаты выполнены.

## WebSocket

Активные WebSocket-сессии комнаты получают:

```json
{
  "schemaVersion": 1,
  "eventId": "4e0fa361-4f7c-4d48-b61a-4a11f3277d93",
  "type": "participant.left",
  "roomId": "AbCdEfGhIjKlMnOpQrStUv",
  "participantId": "8e7d79a8-a49f-48cc-a409-f07890dd3218",
  "roomVersion": 46,
  "occurredAt": "2026-07-09T07:31:30Z",
  "payload": {
    "participantId": "8e7d79a8-a49f-48cc-a409-f07890dd3218",
    "reason": "LEFT"
  }
}
```

После отправки `participant.left` backend закрывает WebSocket-сессии ушедшего participant штатным close code `1000`. WebSocket-сессии остальных участников остаются открытыми.

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
- backend: 53 теста;
- frontend: 7 тестов;
- PoC: 13 тестов;
- `pnpm security:audit`: production-уязвимости не обнаружены;
- Docker Compose: все пять сервисов healthy;
- `infra:check`: REST lifecycle, WebSocket snapshot/reconnect, heartbeat, presence fan-out, unknown command, explicit leave, `participant.left`, capacity after leave, close endpoint и `room.closed` прошли через Nginx и Redis.

## Известные ограничения

- Автоматический timeout inactive participants как `participant.left` reason `TIMEOUT` не входит в WT-206.
- Host transfer и удаление участника host-ом reason `REMOVED` относятся к будущим lifecycle тикетам.
- Кнопка выхода во фронтенде будет подключаться отдельным UI-тикетом.
