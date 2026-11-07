# SPS-722 — вход гостя в Internet-комнату по приглашению

## Цель

Безопасный frontend-путь гостя:

`/join#invite=<token>` → email-код → account cookie → redemption →
`/internet/rooms/{publicRoomId}`.

В этом тикете гость получает membership. Media/LiveKit и host Internet flow не
подключаются. LAN `/api/v1` не меняется.

## Feature flag

`VITE_INTERNET_ROOM_RUNTIME_ENABLED` по умолчанию `false`:

- `/join` остаётся экраном «Просмотр из другого города пока закрыт»;
- сетевые запросы не выполняются;
- LAN create/join без изменений.

При `true` включается guest entry flow. Host Internet-комната по-прежнему не
создаётся через этот тикет.

## Internet API client

Отдельный модуль `frontend/src/features/internet/internet-api.ts`. Пути
`/api/v2` не добавлялись в LAN `room-api`.

| Метод | Путь                                                 |
| ----- | ---------------------------------------------------- |
| GET   | `/api/v2/account`                                    |
| POST  | `/api/v2/auth/email-challenges`                      |
| POST  | `/api/v2/auth/email-challenges/{challengeId}/verify` |
| POST  | `/api/v2/invite-redemptions`                         |
| GET   | `/api/v2/public-rooms/{publicRoomId}`                |

Ответы проверяются Zod-схемами по OpenAPI. Все запросы — `credentials: "include"`.

## Guest-only UI

На `/join` нет создания комнаты, имени host-а, выбора файла, публикации,
перемотки и host controls. Гость вводит только email, одноразовый код и своё
отображаемое имя.

## Безопасность invite token

- Raw token читается только из URL fragment и держится в памяти компонента.
- Не рисуется в DOM, не пишется в console/telemetry, не уходит в path/query.
- В backend уходит только телом `POST /api/v2/invite-redemptions`.
- Повтор redemption использует тот же `Idempotency-Key` без invite token.
- Email, code и session credential не сохраняются в `localStorage` /
  `sessionStorage`.
- После успеха fragment убирается, маршрут — `/internet/rooms/{publicRoomId}`.

## Ошибки

| Ситуация                 | UX                                                               |
| ------------------------ | ---------------------------------------------------------------- |
| `INVITE_UNAVAILABLE`     | «Приглашение недействительно или больше не доступно» без причины |
| `ACCOUNT_REQUIRED` / 401 | шаг к шагу email                                                 |
| 429                      | понятный retry                                                   |
| 5xx / network            | временная ошибка и кнопка «Повторить»                            |

Нет stack trace, JDBC, SMTP и raw backend detail.

## Страница комнаты

`/internet/rooms/{publicRoomId}` проверяет membership через
`GET /api/v2/public-rooms/{id}` и показывает: «Доступ получен, подключение
просмотра готовится». Media не обещается.

## Проверки

- `pnpm check` — ok
- `pnpm contracts:check` — ok
- `git diff --check` — без замечаний

## Откат

`VITE_INTERNET_ROOM_RUNTIME_ENABLED=false` возвращает закрытый экран `/join`
без сетевых запросов. Полный откат тикета убирает guest entry и маршрут
`/internet/rooms/:publicRoomId`.

## Вне тикета

Host Internet flow, LiveKit/media connection, TURN/VM/DNS/TLS, изменения
backend endpoints, PostgreSQL/SMTP provisioning и LAN room UI.
