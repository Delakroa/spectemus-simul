# WT-502 Frontend tests

## Статус

Завершено.

## Цель

Усилить frontend test suite вокруг пользовательски критичных сценариев P4: player state, cleanup media resources, recoverable errors/reconnect, host-only permissions и API contracts. Задача не меняет product behavior, только фиксирует его тестами.

## Поведение под тестами

- Room API commands `leave` и `close` проверяются отдельно: оба идут с `credentials: include`, `POST`, без body; `close` передаёт `X-Host-Secret` только в header.
- Remote playback показывает `error` state, если browser отклоняет autoplay remote video, и сохраняет имя video track в состоянии.
- Host media publication очищается при unmount: останавливается LiveKit publication и снимаются DOM listeners playback tracking.
- Guest session не может опубликовать файл даже при прямом вызове hook action: `publishFileToLiveKit` не вызывается, UI state получает host-only ошибку.

## Реализация

- `frontend/src/features/rooms/room-api.test.ts` — command API contracts для `leaveRoom` и `closeRoom`.
- `frontend/src/features/rooms/remote-playback.test.ts` — autoplay rejection переводит remote playback в `error`.
- `frontend/src/features/rooms/use-room-session-host-controls.test.tsx` — cleanup on unmount и guest host-only publish guard.

## Проверка

```bash
pnpm --filter @watch-together/frontend lint
pnpm --filter @watch-together/frontend typecheck
pnpm --filter @watch-together/frontend test
pnpm format:check
```

Локально в этой задаче проверено:

- `./node_modules/.bin/vitest run src/features/rooms/room-api.test.ts src/features/rooms/remote-playback.test.ts src/features/rooms/use-room-session-host-controls.test.tsx` из `frontend/` прошёл: 3 test files, 20 tests.
- `./node_modules/.bin/tsc -b --pretty false` из `frontend/` прошёл.

## Известные ограничения

- WT-502 остаётся unit/component test hardening. Полноценные multi-user E2E, browser permission matrix и network degradation сценарии остаются в WT-503/WT-504.
- Тесты мокают LiveKit и browser media APIs; real-browser evidence по autoplay/permission UX нужно подтверждать в E2E/manual smoke.
