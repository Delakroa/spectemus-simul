# WT-102 Backend Skeleton

## Статус

Закрыт 2026-07-08.

## Цель

Создать воспроизводимую Spring Boot backend foundation для MVP product backend.

## Область

- Java 25 build target.
- Spring Boot 4.1.x.
- Gradle Kotlin DSL и Gradle Wrapper.
- Spring Web MVC REST foundation.
- Bean Validation dependency.
- Stateless Spring Security baseline.
- Actuator health exposure.
- Тесты Spring context, endpoint и security baseline.

## Вне области

- Product room lifecycle.
- Guest join и participant membership.
- Redis, PostgreSQL, Flyway и persistence.
- WebSocket snapshots/events.
- LiveKit product token generation.
- Chat, voice и media session state.

## Эндпоинты

- `GET /api/v1/health`
- `GET /api/v1/version`
- `GET /actuator/health`

## Критерии приемки

- Health endpoint существует.
- Version endpoint существует.
- Spring context test существует.
- Сборка воспроизводится через Gradle Wrapper репозитория и root `pnpm` commands.

## Проверка

Выполнено перед закрытием WT-102:

```bash
./gradlew :backend:test --no-daemon
./gradlew :backend:build --no-daemon
npm exec --yes pnpm -- check
```

Результат:

- backend context, endpoint, actuator и security tests прошли;
- backend boot jar build прошел;
- PoC Vitest suite прошел: 3 test files, 13 tests;
- PoC production build прошел;
- root `pnpm check` прошел;
- Vite сообщил только существующий large chunk warning для PoC bundle.

## Отчет агента

Сделано:

- добавлен Gradle Wrapper 9.6.1 и Gradle Kotlin DSL backend project;
- backend закреплен на Spring Boot 4.1.0 и Java 25 toolchain;
- добавлены Spring Web MVC, Bean Validation, Spring Security и Actuator foundation;
- добавлены `GET /api/v1/health`, `GET /api/v1/version` и открыт `GET /actuator/health`;
- добавлен stateless security baseline: явно разрешены только public system endpoints, все остальное закрыто deny-by-default;
- backend checks подключены к root `pnpm test`, `pnpm build` и `pnpm check`.

Известное ограничение:

- WT-102 намеренно не создает room lifecycle, persistence, WebSocket events или LiveKit product token generation. Это область следующих тикетов.

## Следующие тикеты

- WT-103: React frontend skeleton.
- WT-104: local infrastructure stack.
- WT-105: CI quality gate.
- WT-106: REST и event contracts.
