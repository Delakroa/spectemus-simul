# WT-106 Контракты

## Статус

Завершено.

## Цель

Зафиксировать проверяемую contract-first границу перед P2 room lifecycle: REST, WebSocket events, error model, coding conventions и Definition of Done.

## Реализовано

- OpenAPI 3.1 для существующих system endpoints.
- Planned contracts для create room, join, snapshot и close.
- Cookie session, отдельный host secret и invite path без секрета.
- Idempotency contract для создания комнаты.
- JSON Schema Draft 2020-12 для общих room/participant/media models.
- Отдельные WebSocket schemas для client commands и server events.
- Версионированный event envelope с event ID, room version и UTC time.
- Safe unknown server event и reject unknown client command.
- RFC 9457-compatible Problem Details с stable code и correlation ID.
- Valid examples и обязательные negative checks.
- Автоматическая OpenAPI/JSON Schema validation в `pnpm check`.
- Расширенные coding conventions.
- Общий Definition of Done.

## Команды

```bash
pnpm contracts:check
pnpm check
```

## Архитектурные решения

Browser session передаётся same-origin HttpOnly cookie. Session credential не возвращается в JavaScript-readable response body и не помещается в WebSocket query string.

Host secret является отдельным credential, возвращается только host при создании комнаты и отсутствует в guest invite path.

Server сохраняет authoritative `roomVersion`. Client event несёт только `expectedRoomVersion`; после reconnect клиент получает полный `room.snapshot`.

## Вне области

- Реализация room controllers и persistence относится к WT-201/202.
- Реализация WebSocket transport и reconnect snapshot относится к WT-203.
- Presence timeout и duplicate connection policy относятся к WT-204.
- Media token endpoint относится к WT-301.
- Полный error UX относится к WT-406.

## Проверено

- Frozen install по `pnpm-lock.yaml`.
- OpenAPI parsing и reference resolution.
- Компиляция четырёх JSON Schema.
- Valid REST/WebSocket examples.
- Reject unknown client command.
- Reject invalid payload известного server event.
- Accept unknown server event с валидным envelope.
- Frontend: 4 test files, 7 tests.
- P0 PoC: 3 test files, 13 tests.
- Backend: 5 tests.
- Frontend, PoC и backend production builds.
- GitHub Actions workflow через actionlint.
- OSV scan: 396 npm packages и 107 Maven packages, issues не найдены.
- Production npm audit: vulnerabilities не найдены.

## Известные ограничения

- Planned endpoints пока возвращаются текущим deny-by-default security baseline как недоступные.
- OpenAPI не публикуется runtime endpoint; файл является repository source of truth.
- Contract generation для TypeScript/Java не добавлена: на текущем размере явные DTO и runtime schemas проще контролировать.
- Максимальный room size зафиксирован как четыре участника для MVP и должен быть подтверждён capacity tests.
