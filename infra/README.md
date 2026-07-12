# Локальная инфраструктура

Локальная Docker Compose среда Watch Together, созданная в WT-104.

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

Начиная с WT-301 `infra:check` создаёт комнату через gateway, проверяет guest join, session replay, restore, LiveKit token grants для host/guest, room WebSocket snapshot, reconnect, heartbeat, leave и close.

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

Compose работает с локальными значениями по умолчанию, поэтому `.env` не обязателен.

Чтобы переопределить порты или credentials:

```bash
cp infra/.env.example infra/.env
```

Docker Compose автоматически читает `infra/.env`, если команда запускается с `--env-file infra/.env`. Корневые команды используют значения по умолчанию; собственный файл можно передать напрямую:

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

Эта среда нужна для воспроизводимой локальной проверки. Бэкенд использует Redis для room state и idempotency; PostgreSQL пока не подключён к product state.

TLS, публичный TURN, monitoring stack и beta deployment находятся вне области WT-104.

## Beta deployment notes

WT-508 добавляет только repo-side подготовку к закрытой beta. Перед публичным запуском нужен внешний TLS/TURN/monitoring слой.

Минимальные production overrides:

- `SESSION_COOKIE_SECURE=true`;
- реальные `REDIS_PASSWORD`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`;
- `LIVEKIT_URL=wss://<livekit-public-host>` — URL, который backend возвращает в token response;
- `PUBLIC_LIVEKIT_URL=wss://<livekit-public-host>` — URL, который встраивается во frontend build;
- `LIVEKIT_NODE_IP=<public-or-private-routable-ip>` — адрес LiveKit для ICE candidates;
- TLS termination должен выставлять `Strict-Transport-Security` и прокидывать `X-Forwarded-Proto`.

После деплоя:

```bash
WT_BETA_BASE_URL=https://<app-host> WT_BETA_LIVEKIT_URL=wss://<livekit-public-host> pnpm beta:smoke
```
