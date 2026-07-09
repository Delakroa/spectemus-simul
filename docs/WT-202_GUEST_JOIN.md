# WT-202 Вход гостя

## Статус

Завершено.

## Цель

Реализовать безопасный вход гостя в существующую комнату с устойчивой participant identity, ограничением вместимости и восстановлением session без создания дублей.

## Endpoint

```http
POST /api/v1/rooms/{roomId}/join
Content-Type: application/json

{
  "displayName": "Guest"
}
```

Успешный ответ:

- HTTP `200 OK`;
- HttpOnly cookie `wt_session`;
- participant текущей session;
- актуальный room snapshot;
- `Cache-Control: no-store`.

## Реализовано

- Room ID и display name проверяются до изменения состояния.
- Отсутствующая, закрытая или истёкшая комната возвращает единый `404 ROOM_UNAVAILABLE`.
- Новый гость получает случайные participant ID и session credential.
- В Redis сохраняется только SHA-256 hash session credential.
- Действующая cookie восстанавливает прежнюю participant identity без создания дубля.
- При повторном join сохраняются исходные participant ID и display name.
- Комната вмещает до четырёх участников вместе с host.
- Новый join в заполненную комнату возвращает `409 ROOM_FULL`.
- Добавление участника увеличивает `roomVersion` и обновляет `updatedAt`.
- Повторный join не изменяет room state и `roomVersion`.
- TTL комнаты не продлевается при join.
- Проверка status/session/capacity и запись выполняются одной Redis Lua operation.

## Session cookie

Cookie использует:

- имя `wt_session`;
- `HttpOnly`;
- `SameSite=Strict`;
- path `/api/v1/rooms`;
- `Max-Age`, равный оставшемуся TTL комнаты;
- `Secure` в зависимости от `SESSION_COOKIE_SECURE`.

В production `SESSION_COOKIE_SECURE` должен быть `true`.

## Проверка

```bash
pnpm backend:test
pnpm contracts:check
pnpm check
pnpm infra:up
pnpm infra:check
```

`infra:check` создаёт комнату через reverse proxy, добавляет гостя, восстанавливает его по cookie, заполняет комнату до лимита и проверяет ответы `ROOM_FULL` и `ROOM_UNAVAILABLE`.

Финальная проверка:

- `pnpm check` прошёл полностью;
- backend: 30 тестов;
- frontend: 7 тестов;
- PoC: 13 тестов;
- `pnpm security:audit`: уязвимости не обнаружены;
- OSV Scanner: уязвимости не обнаружены;
- Docker Compose: все пять сервисов healthy;
- `infra:check`: create, join, session replay, room capacity и unavailable room прошли через reverse proxy и Redis.

## Известные ограничения

- Получение snapshot и WebSocket channel относятся к WT-203.
- Presence timeout и перевод participant в offline относятся к WT-204.
- Close и expiry events относятся к WT-205.
- Create/join UI относится к WT-206.
- Rate limiting и защита от автоматизированного перебора относятся к WT-505.
- Повторный join без прежней cookie считается новой participant identity.
