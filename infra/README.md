# Локальная инфраструктура

Docker Compose stack Watch Together, созданный в WT-104.

## Сервисы

| Сервис     | Назначение                                       | Локальный адрес         |
| ---------- | ------------------------------------------------ | ----------------------- |
| `gateway`  | Nginx, React frontend и reverse proxy для `/api` | `http://127.0.0.1:8088` |
| `backend`  | Spring Boot API                                  | `http://127.0.0.1:8080` |
| `livekit`  | WebSocket/HTTP и WebRTC SFU                      | `ws://127.0.0.1:7880`   |
| `postgres` | PostgreSQL                                       | `127.0.0.1:5432`        |
| `redis`    | Redis                                            | `127.0.0.1:6379`        |

LiveKit TCP fallback доступен на `7881`, UDP media range — `50000-50100`.

## Запуск

Из корня репозитория:

```bash
pnpm infra:up
```

Команда собирает backend/frontend images, запускает все сервисы и ждёт успешного прохождения health checks.

Проверить стек отдельно:

```bash
pnpm infra:check
pnpm infra:ps
```

Начиная с WT-202 `infra:check` создаёт комнату через gateway, подтверждает idempotent create, проверяет guest join и session replay, а также ограничения вместимости и недоступной комнаты.

Открыть приложение:

```text
http://127.0.0.1:8088
```

Посмотреть логи:

```bash
pnpm infra:logs
```

Остановить сервисы без удаления данных:

```bash
pnpm infra:down
```

Удалить сервисы вместе с локальными PostgreSQL/Redis volumes:

```bash
pnpm infra:reset
```

## Настройка

Compose работает с development defaults без обязательного `.env`.

Чтобы переопределить порты или credentials:

```bash
cp infra/.env.example infra/.env
```

Docker Compose автоматически читает `infra/.env`, если команда запускается с `--env-file infra/.env`. Root-команды используют defaults; собственный файл можно передать напрямую:

```bash
docker compose --env-file infra/.env -f infra/compose.yaml up --build -d --wait
```

Все значения из `.env.example` предназначены только для локальной разработки. Их нельзя использовать в production или публиковать как реальные секреты.

## Данные

PostgreSQL и Redis используют named volumes:

- `watch-together_postgres-data`;
- `watch-together_redis-data`.

Обычный `pnpm infra:down` сохраняет данные. `pnpm infra:reset` удаляет их без возможности восстановления.

## Границы

Этот stack создаёт воспроизводимую локальную среду. Backend использует Redis для room state и idempotency; PostgreSQL пока не подключен к product state.

TLS, публичный TURN, monitoring stack и beta deployment находятся вне области WT-104.
