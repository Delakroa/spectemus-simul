# WT-101 Monorepo foundation

## Статус

Завершено 2026-07-08.

## Цель

Создать структуру репозитория для product MVP и сохранить P0 media PoC как reference implementation.

## Область

- Root workspace и root commands.
- Границы `backend/`, `frontend/`, `infra/`, `docs/` и `poc/`.
- Project README.
- Editor и ignore conventions.
- Существующий PoC перенесен в `poc/media-capture-livekit`.

## Вне области

- Spring Boot application code.
- React application code.
- Redis/PostgreSQL compose stack.
- Reverse proxy.
- Product room lifecycle.
- Product LiveKit token flow.

## Критерии приемки

- В репозитории явно разделены product и PoC boundaries.
- Корневые `pnpm test`, `pnpm build` и `pnpm check` задокументированы.
- P0 PoC остаётся запускаемым из корня через `pnpm dev:poc`.
- Реальные секреты не добавлены.

## Проверка

Выполнено после monorepo move и перед закрытием WT-101:

```bash
pnpm test
pnpm build
pnpm check
```

Результат:

- 3 test files прошли.
- 13 tests прошли.
- Production build прошёл.
- Vite сообщил только существующий large chunk warning для PoC bundle.

## Отчет агента

Сделано:

- P0 PoC перенесен в `poc/media-capture-livekit`;
- добавлены root workspace scripts;
- добавлены ownership placeholders для `backend`, `frontend` и `infra`;
- добавлены editor и repository conventions;
- обновлены root README и PoC README.

Известное ограничение:

- WT-101 намеренно не создаёт runnable backend, frontend или infrastructure applications. Это область WT-102, WT-103 и WT-104.

## Следующие тикеты

- WT-102: Spring Boot backend skeleton.
- WT-103: React frontend skeleton.
- WT-104: local infrastructure stack.
