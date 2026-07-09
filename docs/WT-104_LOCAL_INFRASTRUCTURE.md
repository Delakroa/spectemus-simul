# WT-104 Локальная инфраструктура

## Статус

Завершено.

## Цель

Собрать запускаемую одной командой локальную среду для product frontend/backend и media plane, сохранив рабочий P0 PoC как отдельную референсную реализацию.

## Реализовано

- Docker Compose stack из пяти сервисов.
- Multi-stage image Spring Boot backend на Java 25.
- Multi-stage image React frontend с production build.
- Nginx как static server и reverse proxy `/api` в backend.
- LiveKit Server `v1.13.3` с Redis.
- PostgreSQL `18.4`.
- Redis `8.8.0` с AOF persistence и паролем.
- Named volumes для PostgreSQL и Redis.
- Health checks для каждого сервиса.
- Настраиваемые loopback-порты.
- Development env example с явным предупреждением о секретах.
- Автоматический smoke-check контейнеров и HTTP endpoints.

## Запуск

```bash
pnpm infra:up
pnpm infra:check
```

После запуска:

- приложение: `http://127.0.0.1:8088`;
- backend: `http://127.0.0.1:8080`;
- LiveKit: `ws://127.0.0.1:7880`;
- PostgreSQL: `127.0.0.1:5432`;
- Redis: `127.0.0.1:6379`.

Остановка:

```bash
pnpm infra:down
```

## Проверено

- `docker compose config --quiet`.
- Первый build backend, frontend и LiveKit images.
- PostgreSQL, Redis, LiveKit, backend и gateway получили status `healthy`.
- React index загружается через Nginx.
- `GET /api/v1/health` через reverse proxy возвращает `UP`.
- `GET /api/v1/version` через reverse proxy возвращает API `v1`.
- LiveKit HTTP/WebSocket endpoint отвечает на `127.0.0.1:7880`.
- Повторный `pnpm infra:up` использует Docker build cache.

## Секреты

Значения по умолчанию и `infra/.env.example` предназначены только для локальной разработки. Production должен использовать отдельное secret storage и новые PostgreSQL, Redis и LiveKit credentials.

`infra/.env` исключён из git.

## Ограничения

- Backend ещё не подключён к PostgreSQL и Redis на уровне application dependencies.
- Новый React frontend ещё не содержит LiveKit client lifecycle.
- Локальный LiveKit использует loopback candidate и development credentials.
- TLS, TURN/TLS и публичный deployment относятся к beta infrastructure.
