# WT-105 CI quality gate

## Статус

Завершено.

## Цель

Сделать обязательные проверки frontend, backend и P0 PoC воспроизводимыми в GitHub Actions и не допускать незамеченного добавления уязвимых зависимостей.

## Реализовано

- Workflow `Quality Gate` для pull request, merge queue и изменений в `main`.
- Установка зафиксированных версий Node.js 24, pnpm 11.10.0 и Java 25.
- Кэш pnpm store и Gradle dependencies.
- Установка Node.js dependencies только по `pnpm-lock.yaml`.
- Единая команда `pnpm check:ci`.
- ESLint, Prettier, TypeScript typecheck, frontend/PoC/backend tests и production builds.
- JUnit XML для Vitest и HTML/XML reports для Gradle.
- Сохранение test reports как GitHub Actions artifact на 14 дней.
- Dependency Review для новых runtime и development dependencies в pull request.
- OSV-Scanner для pull request, merge queue, изменений в `main` и еженедельной полной проверки.
- SARIF-результаты полного OSV-сканирования в разделе GitHub Code scanning.
- Gradle dependency locking для сканирования точного Java dependency tree.
- Локальная команда `pnpm security:audit` для production npm dependencies.
- Устранены найденные при первом полном сканировании уязвимые версии Vitest/Vite в PoC и Logback в backend.

## Локальный запуск

Обычная полная проверка:

```bash
pnpm check
```

Проверка с созданием машинных test reports:

```bash
pnpm check:ci
```

Быстрый аудит production npm dependencies:

```bash
pnpm security:audit
```

Отчеты локального `pnpm check:ci` создаются в:

- `frontend/reports/tests/`;
- `poc/media-capture-livekit/reports/tests/`;
- `backend/build/reports/tests/test/`;
- `backend/build/test-results/test/`.

## Правила блокировки

`Quality Gate` блокирует pull request при любой ошибке lint, format, typecheck, tests или build.

`Dependency review` блокирует добавление dependency с известной уязвимостью уровня `high` или `critical`. `OSV PR scan` блокирует новые известные уязвимости относительно целевой ветки.

После первого запуска workflow в GitHub для ветки `main` следует включить branch ruleset и сделать обязательными:

- `Quality Gate / Tests, lint and build`;
- `Security Scan / Dependency review`;
- `Security Scan / OSV PR scan`.

Без branch ruleset проверки выполняются и показывают результат, но GitHub технически позволяет смержить pull request с упавшим check.

## Известные ограничения

- Полный OSV scan проверяет известные уязвимости в lockfiles, но не заменяет threat model и security hardening из WT-505.
- Dependency Review доступен для public repositories и private repositories с подходящей GitHub Advanced Security license.
- Docker images и развернутая инфраструктура не сканируются в WT-105; их hardening относится к deployment и security tickets.
