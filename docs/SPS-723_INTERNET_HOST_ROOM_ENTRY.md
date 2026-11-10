# SPS-723 — создание Internet-комнаты host-ом

## Цель

Добавить отдельный browser flow host-а:

`/internet/host` → email challenge → account cookie → public room →
hash-only invite.

Тикет не подключает LiveKit/media и не делает Internet mode
доступным в release build. LAN `/api/v1` не меняется.

## Поведение

- Выбор «Из разных городов» на главной странице открывает
  `/internet/host`, а не вызывает LAN `POST /api/v1/rooms`.
- Существующая account cookie сразу открывает создание комнаты.
- Без account host проходит тот же passwordless email challenge,
  что и guest. Истёкший код можно запросить заново.
- После `POST /api/v2/public-rooms` вызывается
  `POST /api/v2/public-rooms/{id}/invites`.
- Успех показывает ссылку приглашения и переход на
  `/internet/rooms/{publicRoomId}`. Выбора файла и media controls
  в этом тикете нет.

## Безопасность ссылки

`VITE_INTERNET_APP_ORIGIN` обязан быть чистым public HTTPS origin:

- HTTP, loopback, IP literals, credentials, path, query и hash
  отклоняются;
- без валидного origin API-запросы не выполняются и LAN-комната
  не создаётся;
- raw invite token показывается host-у только в ссылке и не
  записывается в browser storage.

## Idempotency и recovery

Room и invite используют разные стабильные `Idempotency-Key`.
Если room уже создана, а invite вернул временную ошибку, retry
не создаёт вторую room. `IDEMPOTENCY_REPLAY_UNAVAILABLE` заменяет
только invite key, потому что backend не может повторно вернуть
сырой token.

## Feature flags и откат

`VITE_INTERNET_ROOM_RUNTIME_ENABLED=false` скрывает host/guest flows.
Backend `/api/v2` по-прежнему отдельно закрыт
`PUBLIC_ACCESS_ENABLED=false`. Откат frontend — вернуть runtime flag в
`false`; LAN flow продолжает работать отдельно.

## Известные границы

- Browser host entry предполагает same-site frontend и `/api/v2`, чтобы
  `Secure; SameSite=Strict` account cookie работала корректно.
- Electron host пока открывает UI с loopback origin. Безопасная
  привязка desktop к public account/control plane — следующий отдельный
  тикет; cookie не ослабляется ради loopback.
- LiveKit token endpoint уже есть, но frontend его в этом тикете не
  вызывает. WSS/TURN, media lifecycle, telemetry и staging не входят.

## Проверки

- `pnpm check`
- `pnpm contracts:check`
- GitHub Quality Gate и Security Scan
