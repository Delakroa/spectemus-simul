# WT-636 — recovery UUID fallback в HTTP LAN

## Проблема

Guest в LAN-режиме открывает приложение по `http://<private-IP>:8088`.
В части браузерных контекстов API `crypto.randomUUID()` там недоступен, поэтому
нажатие «Видео зависло» завершалось сообщением
`globalThis.crypto.randomUUID is not a function` до отправки recovery request.

## Исправление

- Используем `crypto.randomUUID()`, если браузер его предоставляет.
- Для HTTP LAN fallback собирает RFC 4122 version 4 UUID из
  `crypto.getRandomValues()`.
- Если браузер не предоставляет ни одного crypto API, guest получает понятную
  ошибку вместо runtime TypeError.

`requestId` остаётся только техническим correlation ID из WT-632: не содержит
room ID, participant identity, file metadata или media bytes.

## Проверки

    pnpm --filter @watch-together/frontend exec vitest run \
      src/features/rooms/media-recovery-signal.test.ts \
      src/features/rooms/use-room-session-host-controls.test.tsx \
      src/pages/HomePage.test.tsx
    pnpm --filter @watch-together/frontend typecheck
    pnpm --filter @watch-together/frontend lint

Тест эмулирует HTTP LAN, в котором доступен `getRandomValues`, но отсутствует
`randomUUID`, и проверяет валидный UUID v4.
