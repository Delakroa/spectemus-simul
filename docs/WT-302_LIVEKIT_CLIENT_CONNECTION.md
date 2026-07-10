# WT-302 LiveKit client connection

## Статус

Завершено.

## Цель

Подключить product frontend к LiveKit room через backend-issued token из WT-301. После create, join или restore browser должен получить LiveKit token, открыть LiveKit connection и корректно закрывать его при leave, close, room closed или unmount.

## Поведение

- Frontend вызывает `POST /api/v1/rooms/{roomId}/livekit-token` после успешного create/join/restore.
- Подключение выполняется через `livekit-client` и `Room.connect(liveKitUrl, token)`.
- LiveKit lifecycle хранится отдельно от backend room WebSocket lifecycle.
- UI показывает отдельный статус LiveKit: ожидание, подключение, подключён, переподключение, отключён или ошибка.
- Ошибка LiveKit не разрушает room session: backend room, участники, heartbeat и события продолжают жить.
- При leave, close, `room.closed` и unmount frontend вызывает `Room.disconnect()`.

## Границы

WT-302 не добавляет:

- выбор локального видеофайла;
- `captureStream()`;
- publish audio/video tracks;
- remote playback для guest;
- playback controls и product-state синхронизацию.

Эти части остаются для следующих P3-тикетов.

## Проверка

```bash
pnpm --filter @watch-together/frontend typecheck
pnpm --filter @watch-together/frontend lint
pnpm --filter @watch-together/frontend test
pnpm --filter @watch-together/frontend build
pnpm check
```

Локально в этой задаче проверено:

- frontend `tsc`, `eslint` и `vitest` прошли через локальные бинарники `frontend/node_modules/.bin`;
- frontend `vite build` прошёл, `livekit-client` вынесен в отдельный lazy chunk;
- `node scripts/check-contracts.mjs` прошёл;
- `prettier --check` для изменённых Markdown, TS/TSX, CSS, JSON и YAML файлов прошёл;
- `git diff --check` прошёл;
- UI-тесты мокают `livekit-client` и проверяют token request, `Room.connect()` и статус `LiveKit: подключён`.

## Известные ограничения

- WT-302 проверяет сам факт подключения к LiveKit, но не проверяет media publish/subscribe.
- Если LiveKit недоступен, пользователь остаётся в комнате и видит отдельную ошибку media-plane.
- В локальном shell `pnpm/corepack` может отсутствовать; Docker build устанавливает frontend dependencies через Corepack внутри container.
