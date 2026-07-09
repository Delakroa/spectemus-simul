# Definition of Done

Тикет считается завершённым только после проверки применимых пунктов. Неприменимый пункт помечается `N/A` с причиной в документе тикета или PR.

## Область

- Критерии приемки выполнены.
- Изменения соответствуют одному backlog ticket.
- Out of scope и follow-up задачи явно записаны.
- Нет скрытых TODO, временного debug-кода и закомментированной реализации.

## Контракты

- REST/WebSocket/error contracts обновлены до product-кода или вместе с ним.
- Обратная совместимость проверена.
- Новые boundary payload валидируются.
- Примеры и contract fixtures обновлены.
- `pnpm contracts:check` проходит.

## Качество

- Unit и integration tests покрывают новое поведение и ошибки.
- Regression test добавлен для исправленного дефекта.
- `pnpm check` проходит локально.
- GitHub Quality Gate и security checks зелёные.
- Test reports доступны в CI.

## Безопасность и приватность

- Нет секретов, токенов и production credentials в git.
- Movie bytes и локальные file paths не передаются backend.
- Входные данные имеют schema, length и permission validation.
- Ошибки и логи не раскрывают stack trace, credentials и private data.
- Dependency/security scan не содержит необработанных findings.

## Эксплуатация

- Добавлены health/metrics/logging там, где возникает новый operational risk.
- Correlation ID сохраняется на границах request/event.
- Configuration имеет безопасные defaults и env example.
- Data migration и deployment обратимы либо имеют документированный rollback.

## Документация

- Ближайший README и документ тикета обновлены на русском.
- Записаны команды запуска и проверки.
- Записаны известные ограничения и риски следующего тикета.
- PR содержит краткое evidence выполненных проверок.
