# WT-403 Text chat

## Статус

Завершено.

## Цель

Дать участникам комнаты текстовый чат поверх уже существующего room WebSocket (`/api/v1/rooms/{roomId}/events`). Чат работает для host и guest, содержит лимит длины, серверный rate limit, защиту от XSS и системные сообщения о жизненном цикле комнаты.

Сообщения не сохраняются в БД и не покидают комнату: backend не персистит историю, а транслирует сообщение только текущим подключённым сессиям.

## Поведение

- Клиент отправляет `chat.message` (client event) с `payload.clientMessageId` (UUID) и `payload.text` (1–1000 символов) — контракт уже был зафиксирован в WT-106.
- Backend валидирует сообщение (длина 1–1000 code points, не пусто, без управляющих символов кроме `\n` и `\t`), применяет rate limit и транслирует `chat.message` (server event) всем сессиям комнаты, включая отправителя.
- Server payload: `messageId` (серверный UUID), `participantId`, `displayName`, `text`, `sentAt`. `displayName` берётся из авторитетного room state, а не из данных клиента.
- Rate limit: не более `chat-rate-limit` сообщений (по умолчанию 5) за окно `chat-rate-window` (по умолчанию 5s) на пару `(roomId, participantId)`. Превышение возвращает `error` server event с кодом `RATE_LIMITED` (`retryable: true`) и НЕ закрывает соединение.
- Невалидный текст возвращает `error` с кодом `VALIDATION_FAILED` (`retryable: false`) и НЕ закрывает соединение. Структурно битый envelope (нет `clientMessageId`, чужой `participantId`, неверный `schemaVersion`) закрывает соединение с `CloseStatus.BAD_DATA`, как и прочие неизвестные команды.
- Сообщения в закрытую / истёкшую комнату молча отбрасываются.
- XSS: backend отклоняет управляющие символы, frontend рендерит текст только как текстовый узел React (никакого `dangerouslySetInnerHTML`).
- Frontend хранит до 200 последних сообщений в памяти сессии (`chatMessages`), в хронологическом порядке. История эфемерна: не входит в `room.snapshot`, теряется при перезагрузке страницы, но переживает реконнект того же сокета.
- Системные сообщения: frontend добавляет в ленту чата записи `kind: "system"` о `participant.joined`, `participant.left` и `room.closed`, переиспользуя уже приходящие lifecycle-события (backend не шлёт отдельные системные chat-события).

## Реализация

- `contracts/schemas/websocket-server-event.schema.json` — добавлен блок `chat.message` (server event) с payload `messageId`, `participantId`, `displayName`, `text`, `sentAt`.
- `contracts/examples/client/chat-message.json`, `contracts/examples/server/chat-message.json` — примеры, проверяемые в `scripts/check-contracts.mjs`.
- `backend/.../room/RoomServerEvent.java` — фабрики `chatMessage(...)` и `error(...)`, записи `ChatMessagePayload` и `ProblemDetails`.
- `backend/.../room/RoomWebSocketHandler.java` — диспетчеризация `handleTextMessage` на heartbeat / chat.message, `handleChatMessage`, валидация текста, in-memory rate limiter по `(roomId, participantId)`, отправка `error` server event, broadcast всем сессиям, очистка окон rate limit при опустошении и закрытии комнаты.
- `backend/.../room/RoomWebSocketProperties.java` — свойства `chat-rate-limit` и `chat-rate-window`.
- `frontend/src/features/rooms/room-events.ts` — разбор `chat.message`, тип `ChatMessageEvent`, отсутствие мутации room state.
- `frontend/src/features/rooms/use-room-session.ts` — состояние `chatMessages` / `chatError`, действие `sendChatMessage`, синтез системных сообщений, обработка `error` server event.
- `frontend/src/pages/HomePage.tsx`, `frontend/src/styles/global.css` — панель чата (лента сообщений, форма отправки, стили user / system / own).
- Тесты: `RoomWebSocketIntegrationTest` (broadcast, oversized → error, rate limit → error, битый payload → close), `room-events.test.ts` (разбор `chat.message`), `use-room-session-chat.test.tsx` (отправка, приём, системное сообщение, `chatError`, пустое / длинное).

## Проверка

```bash
pnpm contracts:check
pnpm --filter @watch-together/frontend lint
pnpm --filter @watch-together/frontend typecheck
pnpm --filter @watch-together/frontend test
./gradlew :backend:test
```

Локально в этой задаче проверено:

- `node scripts/check-contracts.mjs` прошёл: client и server примеры `chat.message` валидны.
- backend `RoomWebSocketIntegrationTest` прошёл: broadcast чата всем сессиям, oversized → `VALIDATION_FAILED` без закрытия, третий подряд → `RATE_LIMITED` без закрытия, отсутствующий `clientMessageId` → close 1007.
- frontend `eslint`, `tsc -b`, `vitest run` прошли без ошибок; `room-events.test.ts` и `use-room-session-chat.test.tsx` покрывают разбор, отправку, приём, системные сообщения и ошибки.

## Известные ограничения

- История чата эфемерна и хранится только в памяти клиента: реконнект сокета сохраняет её, но перезагрузка страницы, повторный join или сообщения, пришедшие во время кратковременного офлайна, не восстанавливаются (нет replay в `room.snapshot`).
- Rate limiter in-memory и per-instance. При горизонтальном масштабировании backend лимит будет считаться отдельно на каждом узле; для распределённого лимита понадобится Redis-реализация (как в `RedisRoomRealtimeStore`).
- Системные сообщения формируются на frontend из lifecycle-событий и не имеют единого серверного `messageId`; при необходимости общего для всех клиентов системного сообщения его нужно будет эмитить с backend.
- Модерация (удаление сообщений, mute участника, host-only «очистить чат») вне области WT-403.
