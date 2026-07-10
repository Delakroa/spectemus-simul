# Контракты Watch Together

## Назначение

Каталог содержит source of truth для REST API, WebSocket events и общей модели ошибок. Product-код бэкенда и фронтенда должен изменяться вместе с контрактами и проходить `pnpm contracts:check`.

## Состав

- `openapi.yaml`: OpenAPI 3.1 для system API и P2 room lifecycle.
- `schemas/common.schema.json`: общие room, participant и media models.
- `schemas/problem-details.schema.json`: единая REST/WebSocket error model.
- `schemas/websocket-client-event.schema.json`: допустимые команды browser -> backend.
- `schemas/websocket-server-event.schema.json`: события backend -> browser.
- `examples/`: валидные contract fixtures.

`x-implementation-status: planned` в OpenAPI означает согласованный будущий endpoint, а не доступную реализацию.

## REST

- Версия API находится в path: `/api/v1`.
- JSON является единственным request/response format product API.
- Ошибки возвращаются как `application/problem+json`.
- Browser session хранится в opaque cookie `wt_session`.
- Production cookie обязана иметь `HttpOnly`, `Secure` и `SameSite=Strict`.
- Host secret передаётся отдельно и никогда не включается в invite path.
- `POST /api/v1/rooms` требует `Idempotency-Key`.
- `GET /api/v1/rooms/{roomId}` восстанавливает текущего participant и room snapshot по session cookie.
- `POST /api/v1/rooms/{roomId}/leave` удаляет текущего guest participant по session cookie.
- `POST /api/v1/rooms/{roomId}/close` требует host session cookie и `X-Host-Secret`.
- Внешние ответы не содержат локальные пути, movie bytes, stack trace или инфраструктурные секреты.

## WebSocket

Endpoint: `/api/v1/rooms/{roomId}/events`. Upgrade использует same-origin session cookie. Дополнительный credential в query string запрещён.

Транспорт принимает только UTF-8 JSON text messages размером не более 16 KiB. Binary messages и payload, не прошедшие schema validation, закрываются protocol error без изменения состояния.

Общие правила:

- `schemaVersion` определяет версию envelope, текущая версия: `1`;
- `eventId` используется для дедупликации;
- `roomVersion` является authoritative server version;
- client отправляет `expectedRoomVersion`, но не назначает новую server version;
- события с меньшим `roomVersion` клиент игнорирует;
- после reconnect сервер первым отправляет `room.snapshot`;
- `participant.heartbeat` продлевает authoritative presence TTL;
- вход нового guest participant приходит как `participant.joined`;
- изменения presence приходят как `participant.online` и `participant.offline`;
- явный выход guest приходит как `participant.left`, после чего WebSocket-сессия ушедшего участника закрывается;
- закрытие комнаты приходит как `room.closed`, после чего WebSocket-сессия закрывается;
- неизвестный server event с валидным envelope безопасно игнорируется;
- неизвестный client command отклоняется;
- `participantId` берётся из session и сверяется с payload;
- `occurredAt` передаётся в UTC в формате RFC 3339.

## Ошибки

Модель расширяет RFC 9457 полями:

- `code`: стабильный машинный код;
- `correlationId`: UUID для диагностики;
- `retryable`: допустимость безопасного повтора;
- `violations`: ошибки отдельных полей.

Стартовый каталог:

| HTTP | Code                      | Retryable | Назначение                                        |
| ---: | ------------------------- | :-------: | ------------------------------------------------- |
|  400 | `MALFORMED_REQUEST`       |    нет    | Некорректный JSON или структура запроса           |
|  401 | `AUTHENTICATION_REQUIRED` |    нет    | Нет действующей session                           |
|  403 | `ACCESS_DENIED`           |    нет    | Недостаточно прав                                 |
|  404 | `ROOM_UNAVAILABLE`        |    нет    | Комната недоступна без раскрытия её существования |
|  409 | `IDEMPOTENCY_CONFLICT`    |    нет    | Key повторен с другим payload                     |
|  409 | `ROOM_FULL`               |    нет    | Достигнут participant limit                       |
|  409 | `ROOM_STATE_CONFLICT`     |    да     | Операция основана на устаревшей room version      |
|  422 | `VALIDATION_FAILED`       |    нет    | Предметная валидация не прошла                    |
|  429 | `RATE_LIMITED`            |    да     | Превышен rate limit                               |
|  500 | `INTERNAL_ERROR`          |    да     | Безопасная внутренняя ошибка                      |

Frontend отображает локализованный текст по `code`. Неизвестный code обрабатывается как generic error с `correlationId`; raw `detail` не считается готовым пользовательским текстом.

## Совместимость

Обратимо совместимы:

- новый необязательный response field;
- новый server event type;
- новый error code с сохранением HTTP semantics.

Требуют новой API или schema version:

- удаление или переименование поля;
- изменение типа или смысла поля;
- превращение optional field в required;
- изменение HTTP method/path/status semantics;
- изменение WebSocket envelope.

## Проверка

```bash
pnpm contracts:check
```

Проверка входит в `pnpm check` и CI Quality Gate.
