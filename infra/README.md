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

## Проверка между домашними компьютерами (LAN)

Обычный запуск намеренно доступен только на host-компьютере. Чтобы проверить
комнату между Windows и Mac в **той же приватной домашней сети**, не меняйте
`compose.yaml` и не открывайте router port forwarding.

На компьютере host-а с Docker Desktop используйте одну команду. Она выберет
private IPv4, поднимет LAN-стек и выполнит doctor; на Windows также запросит
UAC только для узких firewall-правил Private-профиля:

```bash
pnpm host:lan:start
```

Запуск без терминала доступен в корне проекта:

- Windows — дважды кликните [`Start-Spectemus-Simul.cmd`](../Start-Spectemus-Simul.cmd).
- macOS — дважды кликните [`Start-Spectemus-Simul.command`](../Start-Spectemus-Simul.command).

После готовности запускатор сам откроет браузер с адресом host-а; при ошибке
окно останется открытым с понятной причиной. На Windows и macOS он также сам
откроет Docker Desktop и ждёт готовности до двух минут. Однократно до первого
запуска всё ещё нужны установленные Node.js/pnpm и Docker Desktop.

Если у host-а два физических подключения, укажите адрес домашней сети явно:

```bash
pnpm host:lan:start -- --ip 192.168.1.42
```

Команда не предназначена для публичного IP, проброса портов на router, VPN
exit node или облачной VM. Для ручного восстановления остаётся прежняя
последовательность — она создаёт `infra/lan.env`; адрес не нужно вписывать в
файл вручную:

```bash
pnpm infra:lan:setup
pnpm infra:lan:up
pnpm infra:lan:doctor
```

Если у host-а два физических подключения, setup безопасно остановится и
покажет кандидаты. В этом единственном случае передайте выбранный адрес явно:

```bash
pnpm infra:lan:setup -- --ip 192.168.1.42
```

`infra:lan:doctor` проверяет gateway, LiveKit TCP-сигналинг, TCP fallback и
создаёт короткоживущую test-room, чтобы убедиться: backend отдаёт в token
`ws://<IPv4-host>:7880`, а не `localhost` или адрес другого компьютера.

На Windows `host:lan:start` вызывает Windows bootstrap. Его можно запустить
напрямую, если требуется только повторить Windows-часть: он запросит
стандартный UAC для двух узких firewall-правил, не меняет router и не действует
для Public/Domain profile:

```bash
pnpm infra:lan:windows
```

С Mac guest-компьютера повторите doctor **через Windows IP**:

```bash
pnpm infra:lan:doctor -- --host 192.168.1.42
```

Только после зелёного результата открывайте на Mac
`http://192.168.1.42:8088`, создавайте новую комнату на Windows по этому же
адресу и передавайте новую invite-ссылку. Gateway и LiveKit сигналинг будут
доступны в LAN; backend, Redis и PostgreSQL останутся на loopback.

Если удалённый doctor не может открыть gateway или TCP-порты с Mac, повторите
на Windows `pnpm infra:lan:windows`. Если он сообщает о профиле `Public`, сначала
измените только доверенную домашнюю сеть на `Private` в Windows Settings. Полная
граница и повторяемые firewall-правила описаны в
[WT-624 Windows LAN bootstrap](../docs/WT-624_WINDOWS_LAN_BOOTSTRAP.md).

После проверки вернуть обычный закрытый режим:

```bash
pnpm infra:lan:down
pnpm infra:up
```

Этот режим не является staging или production: нет TLS, public TURN и
secure-cookie semantics. Doctor подтверждает control path и TCP fallback, но
UDP `50000–50100` проверяется только реальным просмотром с другого компьютера.
Браузеры по правилам безопасности не дают доступ к микрофону на
`http://<private-IP>`: в LAN проверяйте room/file/chat, а голос — только через
`https` staging или `localhost`. Не используйте этот режим с публичным IP,
пробросом портов на router, VPN exit node или облачной VM.

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
- `FEEDBACK_ADMIN_TOKEN=<secret>` — включает WT-605 operator endpoints (list/export/triage); без него beta feedback только пишется, но не читается;
- `WT_CSP_CONNECT_SRC='self' wss://<livekit-public-host>` — сужает CSP `connect-src` под фиксированный beta-host (WT-606);
- rate limiting (WT-606) включён по умолчанию; `RATE_LIMIT_*` overrides — в `application.yml`;
- TLS termination должен выставлять `Strict-Transport-Security` и прокидывать `X-Forwarded-Proto`.

После деплоя:

```bash
WT_BETA_BASE_URL=https://<app-host> WT_BETA_LIVEKIT_URL=wss://<livekit-public-host> pnpm beta:smoke
```

## Reproducible staging bootstrap

Для реального WT-610 не открывайте `compose.yaml` наружу: он предназначен для
локальной разработки. [staging/](staging/) содержит application compose,
env-template и Caddy route fragment для Linux VM, на котором LiveKit +
embedded TURN/TLS подняты official generator-ом. Этот путь разделяет Redis
databases, оставляет backend/gateway на loopback и фиксирует DNS/firewall,
TLS, rollback и публичные smoke-команды.
