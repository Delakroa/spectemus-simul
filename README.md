# Watch Together

Watch Together — MVP для приватного синхронного просмотра. Host выбирает локальный видеофайл, создает приватную комнату и приглашает гостей одной ссылкой. Приложение не является видеохостингом: байты фильма остаются на машине host.

## Текущий статус

P0 технически подтвержден.

- WT-001 доказал путь локальный MP4 -> `captureStream()` -> LiveKit -> guest.
- WT-002 зафиксировал границы браузеров и кодеков.
- WT-003 зафиксировал первый baseline качества и задержки.
- WT-004 принял решение по media pipeline и добавил первый data-channel прототип playback-state.
- WT-101 создал monorepo-структуру.
- WT-102 добавил Spring Boot backend skeleton.
- WT-103 добавил React frontend foundation.
- WT-104 добавил запускаемый Docker Compose stack.
- WT-105 добавил CI quality gate, test reports и dependency security scan.
- WT-106 зафиксировал REST, WebSocket и error contracts.
- WT-201 реализовал создание приватной комнаты с Redis TTL и idempotency.
- WT-202 реализовал вход гостя, session identity и ограничение вместимости комнаты.

P1 foundation завершен. Проект находится в P2 room lifecycle. Realtime snapshot, presence, chat, voice и product-токены LiveKit намеренно оставлены для следующих тикетов.

## Структура репозитория

```text
backend/                    Spring Boot backend skeleton.
contracts/                  OpenAPI, JSON Schema и contract examples.
frontend/                   React frontend foundation.
infra/                      Локальный Docker Compose stack.
docs/                       Планы, ADR, заметки по совместимости и качеству.
poc/media-capture-livekit/  P0 proof of concept для media pipeline.
```

## Корневые команды

Установить зависимости из корня репозитория:

```bash
pnpm install
```

Запустить все текущие проверки:

```bash
pnpm contracts:check
pnpm test
pnpm build
pnpm check
```

Запустить CI-вариант с машинными отчетами тестов и аудит production npm dependencies:

```bash
pnpm check:ci
pnpm security:audit
```

Запустить backend-проверки отдельно:

```bash
pnpm backend:test
pnpm backend:build
```

Запустить backend локально:

```bash
pnpm backend:bootRun
```

Запустить frontend локально:

```bash
pnpm dev:frontend
```

Собрать и запустить весь локальный stack:

```bash
pnpm infra:up
pnpm infra:check
```

Приложение будет доступно на `http://127.0.0.1:8088`.

Остановить локальный stack:

```bash
pnpm infra:down
```

Запустить P0 media PoC из корня:

```bash
pnpm dev:poc
```

Остановить PoC LiveKit container:

```bash
pnpm dev:poc:down
```

## P0-референс

Media PoC остается референсной реализацией в [poc/media-capture-livekit](poc/media-capture-livekit/README.md).

Важные P0-документы:

- [WT-002 матрица совместимости](docs/WT-002_COMPATIBILITY_MATRIX.md)
- [WT-003 качество и задержка](docs/WT-003_QUALITY_LATENCY.md)
- [WT-004 media pipeline ADR](docs/WT-004_MEDIA_PIPELINE_ADR.md)
- [WT-004 product-state прототип](docs/WT-004_PRODUCT_STATE.md)
- [WT-102 backend skeleton](docs/WT-102_BACKEND_SKELETON.md)
- [WT-103 React frontend](docs/WT-103_REACT_FRONTEND.md)
- [WT-104 локальная инфраструктура](docs/WT-104_LOCAL_INFRASTRUCTURE.md)
- [WT-105 CI quality gate](docs/WT-105_CI_QUALITY_GATE.md)
- [WT-106 контракты](docs/WT-106_CONTRACTS.md)
- [WT-201 создание комнаты](docs/WT-201_CREATE_ROOM.md)
- [WT-202 вход гостя](docs/WT-202_GUEST_JOIN.md)
- [Definition of Done](docs/DEFINITION_OF_DONE.md)

## Правила foundation

- Не загружать байты фильма в backend services.
- LiveKit остается media plane.
- Spring Boot в будущем отвечает за rooms, roles, access, state, tokens, presence, TTL, audit и telemetry.
- Не переносить PoC token или room logic в product code без WT-301 и room lifecycle contracts.
- Секреты хранить только в локальных `.env` файлах или secret storage. В git коммитить examples, а не реальные значения.
