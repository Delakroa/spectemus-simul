# Контракты Watch Together

## Назначение

Каталог содержит source of truth для REST API, WebSocket events и общей модели ошибок. Product-код backend и frontend должен изменяться вместе с контрактами и проходить `pnpm contracts:check`.

## Состав

- `openapi.yaml`: OpenAPI 3.1 для system API и P2 room lifecycle.
- `schemas/common.schema.json`: общие room, participant и media models.
- `schemas/problem-details.schema.json`: единая REST/WebSocket error model.
- `schemas/websocket-client-event.schema.json`: допустимые команды browser -> backend.
- `schemas/websocket-server-event.schema.json`: события backend -> browser.
- `examples/`: валидные contract fixtures.

`x-implementation-status: planned` в OpenAPI означает согласованный будущий endpoint, а не доступную реализацию.

## REST

- API version находится в path: `/api/v1`.
- JSON является единственным request/response format product API.
- Ошибки возвращаются как `application/problem+json`.
- Browser session хранится в opaque `wt_session` cookie.
- Production cookie обязана иметь `HttpOnly`, `Secure` и `SameSite=Strict`.
- Host secret передается отдельно и никогда не включается в invite path.
- `POST /api/v1/rooms` требует `Idempotency-Key`.
- Внешние ответы не содержат локальные пути, movie bytes, stack trace или инфраструктурные секреты.

## WebSocket

Endpoint: `/api/v1/rooms/{roomId}/events`. Upgrade использует same-origin session cookie. Дополнительный credential в query string запрещен.

Транспорт принимает только UTF-8 JSON text messages размером не более 16 KiB. Binary messages и payload, не прошедшие schema validation, закрываются protocol error без применения состояния.

Общие правила:

- `schemaVersion` определяет версию envelope, текущая версия: `1`;
- `eventId` используется для дедупликации;
- `roomVersion` является authoritative server version;
- client отправляет `expectedRoomVersion`, но не назначает новую server version;
- события с меньшим `roomVersion` клиент игнорирует;
- после reconnect сервер первым отправляет `room.snapshot`;
- `participant.heartbeat` продлевает authoritative presence TTL;
- изменения presence приходят как `participant.online` и `participant.offline`;
- неизвестный server event с валидным envelope безопасно игнорируется;
- неизвестный client command отклоняется;
- `participantId` берется из session и сверяется с payload;
- `occurredAt` передается в UTC в RFC 3339 формате.

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
|  404 | `ROOM_UNAVAILABLE`        |    нет    | Комната недоступна без раскрытия ее существования |
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
