# SPS-725 — public LiveKit client к Internet-комнате

## Цель

После входа в Internet-комнату host и guest получают короткоживущий public
LiveKit token и подключаются к public LiveKit. Передачу фильма, remote tracks,
playback sync и microphone этот тикет не реализует.

## Поведение

1. Browser guest на `/internet/rooms/{publicRoomId}` проверяет membership через
   cookie `wt_account`, затем `POST /api/v2/public-rooms/{id}/livekit-token` с
   `credentials: include`.
2. Desktop host mintит token только в Electron main через
   `mintPublicLiveKitToken(publicRoomId)` → `authorizedFetch` с
   `Authorization: Bearer` device credential.
3. Cookie имеет приоритет, если в запросе есть и cookie, и Bearer.
4. Renderer получает только короткоживущий LiveKit JWT и безопасные поля
   ответа. `deviceCredential`, `apiOrigin` и другие постоянные секреты в
   renderer не попадают. Ошибки mint через IPC приходят plain-object
   `ApiProblemError` (`code`, `status`, `retryable`): поля на `Error` Electron
   не сохраняет, поэтому 401/404/429 остаются различимыми на desktop.
5. `InternetRoomPage` подключается через существующий `connectLiveKitRoom` и
   показывает состояния подключения / подключено / переподключение / ошибка с
   кнопкой «Подключить снова».
6. При unmount или смене комнаты выполняется abort и `disconnect`.
7. Microphone, фильм и другие tracks не публикуются.

## Безопасность

- Token не сохраняется в `localStorage` / `sessionStorage` и не попадает в URL
  или логи.
- Renderer не выбирает LiveKit URL самостоятельно: URL приходит в ответе mint.
- LAN `/api/v1/.../livekit-token` и LAN LiveKit credentials не используются.
- `PUBLIC_ACCESS_ENABLED`, `PUBLIC_LIVEKIT_ENABLED` и
  `VITE_INTERNET_ROOM_RUNTIME_ENABLED` остаются выключенными по умолчанию.
- OpenAPI: `accountSessionCookie` или `deviceSessionBearer` как альтернативные
  схемы для public livekit-token.

## Feature flags и откат

При любом выключенном флаге public LiveKit endpoint отсутствует или UI не
открывает комнату. LAN API и LAN-комнаты не меняются.

## Известные границы

Публикация фильма, воспроизведение remote tracks, playback sync, microphone,
TURN/DNS/VM deployment, telemetry и включение Internet mode — вне тикета.

## Проверки

- backend: cookie, device Bearer, cookie priority, expired/revoked session,
  non-member, feature off
- desktop: UUID validation, Bearer mint, renderer-safe payload без
  `deviceCredential` / `apiOrigin`, без LAN path; 401/404/429 как IPC
  plain-object problem (не `Error`)
- frontend: browser cookie path, desktop IPC path, cleanup disconnect, retry,
  понятные 401/404/429 для browser и desktop, без LAN LiveKit
- `pnpm check`
