# WT-402 Host reconnect

## Статус

Завершено.

## Цель

Пережить разрыв соединения host без немедленной потери комнаты. При обрыве WebSocket host комната переходит в `HOST_DISCONNECTED`, гостям приходит `host.disconnected` с дедлайном, и запускается grace period. Если host возвращается вовремя — статус восстанавливается и приходит `host.reconnected`. Если нет — по истечении grace комната закрывается с причиной `HOST_TIMEOUT`.

Роль host определяется authoritative backend-состоянием (`hostParticipantId`), файл на сервер по-прежнему не загружается.

## Поведение

- При закрытии WebSocket host (presence `OFFLINE` и `participantId == hostParticipantId`) backend запоминает текущий активный статус комнаты, переводит её в `HOST_DISCONNECTED` (atomic Lua), транслирует `host.disconnected {reconnectDeadline}` всем оставшимся сессиям и планирует grace-таймер на `now + host-reconnect-grace` (по умолчанию 60s, настраивается).
- Обычный выход guest поведение не меняет: `host.disconnected` шлётся только для host.
- При реконнекте host в пределах grace: таймер отменяется, комната восстанавливается `HOST_DISCONNECTED → <предыдущий статус>` (atomic Lua), host получает свежий `room.snapshot` с восстановленным статусом, а остальным транслируется `host.reconnected {participantId, status, updatedAt}`.
- По истечении grace grace-таймер вызывает server-initiated close, защищённый статусом: закрывает комнату только если она всё ещё `HOST_DISCONNECTED` (если host успел вернуться — no-op). При закрытии приходит `room.closed {reason: HOST_TIMEOUT}` и сессии закрываются.
- Grace-таймер отменяется при закрытии комнаты любым путём (host close, expiry, host timeout) — по аналогии с таймером expiry.
- Frontend: `host.disconnected` переводит локальный snapshot в `HOST_DISCONNECTED` и показывает баннер «Host отключился, ждём…» с дедлайном; `host.reconnected` применяет серверный `status`, обновляет `updatedAt` и снимает баннер; оба события добавляются в ленту чата как системные сообщения.

## Реализация

- `contracts/schemas/websocket-server-event.schema.json` — в `room.closed.reason` добавлен `HOST_TIMEOUT`; `host.reconnected` несёт восстановленный `status` и `updatedAt`.
- `contracts/examples/server/host-disconnected.json`, `host-reconnected.json` — примеры, проверяемые в `scripts/check-contracts.mjs`.
- `backend/.../room/RoomClosedReason.java` — добавлен `HOST_TIMEOUT`.
- `backend/.../room/RoomServerEvent.java` — фабрики `hostDisconnected(...)` / `hostReconnected(...)` и payload-записи.
- `backend/.../room/RoomLifecycleStore.java` — `markHostDisconnected`, `recoverHost`, `closeAbandonedRoom` + результат `HostPresenceResult`.
- `backend/.../room/RedisRoomLifecycleStore.java` — три atomic Lua-скрипта (переход в `HOST_DISCONNECTED` с сохранением предыдущего статуса, восстановление этого статуса, закрытие с защитой по статусу).
- `backend/.../room/RoomWebSocketProperties.java` — свойство `host-reconnect-grace`.
- `backend/.../room/RoomWebSocketHandler.java` — определение host при disconnect/reconnect, `host.disconnected`/`host.reconnected` broadcast, `hostReconnectTasksByRoom` grace-таймеры (`scheduleHostReconnect` / `cancelHostReconnect` / `closeAbandonedRoom`), очистка таймера при закрытии комнаты.
- `frontend/src/features/rooms/room-events.ts` — разбор и reducer для `host.disconnected` / `host.reconnected`, причина `HOST_TIMEOUT`.
- `frontend/src/features/rooms/use-room-session.ts` — состояние `hostReconnectDeadline`, системные сообщения о host-событиях.
- `frontend/src/pages/HomePage.tsx`, `frontend/src/styles/global.css` — баннер `system-message--warning` при `HOST_DISCONNECTED`.
- Тесты: `RoomWebSocketIntegrationTest` (mark disconnected + broadcast, recover + broadcast, grace timeout → `HOST_TIMEOUT`), `room-events.test.ts` (переходы статуса), `use-room-session-chat.test.tsx` (системное сообщение).

## Проверка

```bash
pnpm contracts:check
pnpm --filter @watch-together/frontend lint
pnpm --filter @watch-together/frontend typecheck
pnpm --filter @watch-together/frontend test
./gradlew :backend:test
```

Локально в этой задаче проверено:

- `node scripts/check-contracts.mjs` прошёл: примеры `host.disconnected` / `host.reconnected` валидны, `HOST_TIMEOUT` принят.
- backend `RoomWebSocketIntegrationTest` прошёл: host disconnect → `host.disconnected`, host reconnect → снапшот с восстановленным статусом + `host.reconnected`, истечение grace → `room.closed(HOST_TIMEOUT)` и закрытие сессий (grace выставлен в 500ms через test property).
- frontend `eslint`, `tsc -b`, `vitest run` прошли без ошибок.

## Известные ограничения

- Rate limiter и grace-таймеры — in-memory, per-instance. При горизонтальном масштабировании backend таймер живёт на узле, принявшем disconnect; для распределённого поведения понадобится общий планировщик или Redis.
- У frontend нет авто-reconnect WebSocket: реконнект host на практике = перезагрузка вкладки (route → `restore`). После перезагрузки выбранный файл и его object URL теряются, поэтому автоматический republish дорожек невозможен — host должен заново выбрать файл, чтобы возобновить показ. In-place republish без перезагрузки (авто-reconnect WS + сохранение медиасессии) остаётся за WT-406 / будущими задачами.
- Системные сообщения о host-событиях формируются на frontend и не имеют общего серверного `messageId`.
