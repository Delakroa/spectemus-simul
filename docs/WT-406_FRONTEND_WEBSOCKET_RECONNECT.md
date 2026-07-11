# WT-406 Frontend reconnect и Error UX

## Статус

Завершено.

## Цель

Сделать frontend устойчивым к кратковременному разрыву room WebSocket без перезагрузки страницы и привести ошибки комнаты/media-plane к понятному UX: клиент должен переподключиться, получить свежий `room.snapshot`, сохранить локальную эфемерную историю чата, помочь host восстановить показ выбранного файла и дать пользователю явное действие восстановления вместо “сырых” ошибок или бесконечного ожидания.

Backend-семантика WT-402 остаётся source of truth: room state, presence, `HOST_DISCONNECTED`, `host.reconnected` и `room.closed(HOST_TIMEOUT)` определяются сервером.

## Поведение

- При неожиданном закрытии room WebSocket frontend переводит `connectionStatus` в `reconnecting`, добавляет локальное событие «Соединение потеряно, переподключаемся» и планирует повторное подключение.
- Backoff: 1s, 2s, 5s, 10s, далее 15s; максимум 10 попыток. После исчерпания попыток UI показывает ошибку «Не удалось восстановить WebSocket комнаты».
- Успешный `open` сбрасывает счётчик попыток, возвращает статус `open`, отправляет heartbeat и добавляет локальное событие «Соединение с комнатой восстановлено».
- Повторное WebSocket-подключение не очищает `chatMessages`: текущие 200 сообщений в памяти страницы сохраняются. Свежий `room.snapshot`, который backend присылает первым сообщением после connect/reconnect, полностью обновляет authoritative room state.
- Ручной `leave`, host `close`, `room.closed`, `CLOSED` и `EXPIRED` не запускают auto-reconnect.
- Если LiveKit разорвал соединение во время активной публикации host-файла, frontend останавливает старые tracks, запоминает необходимость восстановления и после возврата LiveKit в `connected` автоматически вызывает повторную публикацию выбранного локального файла.
- Если выбранный файл уже потерян из памяти страницы, frontend показывает host-у ошибку с просьбой выбрать файл заново. Байты файла по-прежнему не сохраняются на backend.
- HTTP problem details из backend теперь сохраняются в `ApiProblemError`: `status`, `code`, `retryable`, `instance` и `correlationId` не теряются при отображении.
- Глобальные ошибки комнаты, room WebSocket и LiveKit превращаются в `userError`: понятный заголовок, сообщение, metadata для дебага и recovery-действие, если ошибка retryable.
- После исчерпания WebSocket auto-reconnect UI показывает кнопку «Переподключить» и не оставляет пользователя в бесконечном `reconnecting`.
- Ошибка LiveKit token/connect показывает кнопку «Повторить LiveKit» без пересоздания комнаты.
- Ошибки выбора файла, публикации файла и микрофона остаются рядом с соответствующим контролом и получают локальные действия «Другой файл» или «Повторить».

## Реализация

- `frontend/src/features/rooms/room-api.ts` — `ApiProblemError` сохраняет problem details вместо потери backend metadata.
- `frontend/src/features/rooms/use-room-session.ts` — статус `reconnecting`, reconnect timer/backoff, сохранение чата при повторном WebSocket, сброс таймеров при ручном disconnect, recovery-флаг для host publication после LiveKit `disconnected -> connected`, `userError` и команды `retryLastRoomAction`, `retryRoomConnection`, `retryLiveKitConnection`.
- `frontend/src/pages/HomePage.tsx` — label «переподключение» для room WebSocket, общий error banner с recovery-действиями, локальные recovery-кнопки для файла и голоса.
- `frontend/src/styles/global.css` — warning-цвет для `connecting` / `reconnecting`, стили actionable error banner и inline recovery errors.
- `frontend/src/features/rooms/room-api.test.ts` — problem details сохраняются в `ApiProblemError`.
- `frontend/src/features/rooms/use-room-session-chat.test.tsx` — сценарий unexpected WebSocket close → reconnect → fresh `room.snapshot` + сохранённый чат.
- `frontend/src/features/rooms/use-room-session-host-controls.test.tsx` — сценарий LiveKit `disconnected -> connected` после live-публикации → автоматический republish выбранного файла.
- `frontend/src/pages/HomePage.test.tsx` — problem details в UI и retry LiveKit без пересоздания комнаты.

## Проверка

```bash
pnpm --filter @watch-together/frontend lint
pnpm --filter @watch-together/frontend typecheck
pnpm --filter @watch-together/frontend test
pnpm format:check
```

Локально в этой задаче проверено:

- `./node_modules/.bin/vitest run src/features/rooms/room-api.test.ts src/features/rooms/use-room-session-chat.test.tsx src/pages/HomePage.test.tsx` из `frontend/` прошёл: 3 test files, 30 tests.
- `./node_modules/.bin/tsc -b --pretty false` из `frontend/` прошёл.

## Известные ограничения

- Auto-reconnect не replay-ит события, пришедшие во время офлайна. Комната восстанавливается по свежему `room.snapshot`, но эфемерные chat-сообщения без replay в `room.snapshot` могут быть пропущены.
- Выбранный локальный файл живёт только в памяти текущей страницы. После refresh или закрытия вкладки browser не отдаёт прежний `File`, поэтому host должен выбрать файл заново.
- Reconnect не создаёт новый participant и не меняет backend session identity; если cookie/session недоступны или room уже terminal, восстановление завершится ошибкой или закрытым состоянием.
