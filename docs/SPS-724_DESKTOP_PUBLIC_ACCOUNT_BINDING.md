# SPS-724 — безопасная привязка desktop host к public account

## Цель

Дать Electron-приложению связаться с подтверждённым public account без
ослабления `Secure; HttpOnly; SameSite=Strict` cookie и без передачи
session credential, email или секрета привязки в URL.

## Поведение

1. Host выбирает «Из разных городов» в desktop.
2. Renderer предлагает подтвердить аккаунт в системном браузере.
3. Main process стартует device-authorization binding и открывает
   публичный HTTPS `/internet/link#binding=<uuid>` через `openExternal`.
   Trusted API origin берётся только из `SPECTEMUS_PUBLIC_API_ORIGIN` в
   main; renderer не передаёт URL через IPC.
4. В системном браузере пользователь входит по email (`wt_account`) и
   подтверждает одноразовый `userCode`.
5. Desktop обменивает `deviceCode` через POST body на короткоживущую
   account-сессию устройства. Exchange, insert session, чтение профиля и
   audit выполняются в одной транзакции. Любая ошибка откатывает binding
   в `APPROVED`, поэтому desktop может безопасно повторить exchange.
6. Credential остаётся в Electron main process, шифруется через
   `safeStorage` и не попадает в renderer, localStorage, sessionStorage
   или URL.
7. После привязки main process создаёт public room и invite с
   `Authorization: Bearer`.
8. LAN `/api/v1` и LAN-комнаты не меняются.

## Безопасность

- `PUBLIC_ACCESS_ENABLED=false` и `PUBLIC_DEVICE_BINDING_ENABLED=false`
  по умолчанию; оба флага fail-closed.
- Verification origin — только public HTTPS без loopback, IP literals,
  credentials, path, query и fragment. Path строго `/internet/link`.
- В БД хранятся HMAC fingerprints `deviceCode`, `userCode` и
  `deviceCredential`.
- Approve требует действующую `wt_account`.
- Poll/exchange и revoke принимают секреты только в POST body.
- Отдельные rate-limit buckets: start / approve / token. Бюджет token
  покрывает полный TTL polling (default 150 / 15m при TTL 10m и
  interval 5s).
- Ошибки стабильны: `DEVICE_BINDING_UNAVAILABLE`,
  `DEVICE_AUTHORIZATION_PENDING`, `DEVICE_CODE_REJECTED`,
  `ACCOUNT_REQUIRED` — без account enumeration.
- Logout/revoke удаляет локальный credential только после успешного
  remote revoke; при ошибке credential сохраняется для повтора.
- Просроченный локальный credential не показывается как активная
  привязка.

## Feature flags и откат

`VITE_INTERNET_ROOM_RUNTIME_ENABLED=false` скрывает UI. Backend surface
исчезает при `PUBLIC_DEVICE_BINDING_ENABLED=false` или
`PUBLIC_ACCESS_ENABLED=false`. Browser host cookie-flow на
`/internet/host` остаётся отдельным путём для same-site web.

## Известные границы

- Передача фильма, public LiveKit connect/publish, TURN/DNS/VM и
  включение Internet mode по умолчанию — вне тикета.
- Device session не заменяет browser cookie для guest invite entry.

## Проверки

- `pnpm contracts:check`
- backend: expiry, replay, wrong code/account, feature off, atomic
  exchange/profile/audit rollback и проверка polling-бюджета по реальным
  default properties
- desktop: fixed origin, path allowlist, openExternal, poll cancel,
  safeStorage, fail-closed revoke, expired status, TTL/rate-limit budget
- frontend: waiting / confirm / error / cancel на `/internet/link` и
  desktop host binding
- `pnpm check`
