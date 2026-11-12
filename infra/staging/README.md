# WT-610 staging bootstrap

Этот каталог готовит application layer для **одного Linux VM** с официальным
production generator LiveKit. Он не разворачивает сервер сам и не содержит
сертификатов, DNS-записей или секретов.

## Принятое разделение

```text
app.<domain>  ── TLS ─┐
rtc.<domain>  ── TLS ─┼─ Caddy из official LiveKit generator ─┐
turn.<domain> ── TLS ─┘                                      ├─ LiveKit / embedded TURN
                                                              └─ 127.0.0.1:8088 Spectemus Simul gateway
```

`infra/staging/compose.yaml` запускает только backend и gateway. LiveKit,
Caddy, TURN/TLS и Redis создаются отдельно official generator-ом LiveKit;
так не появляется самодельная и неподдерживаемая TURN-конфигурация.
Сам по себе этот compose остаётся историческим LAN/beta-контуром. Internet
mode включается только с отдельным `public.compose.yaml` и защищённым набором
public-настроек. Никакой флаг не включён по умолчанию.

LiveKit использует Redis database `0`; backend задан `SPRING_DATA_REDIS_DATABASE=1`.
Оба используют один Redis password, но ключи product state изолированы от
LiveKit state.

## Предусловия VM

- Linux VM с публичным IPv4, Docker Compose и доступом по SSH;
- три DNS A/AAAA записи на этот IP: `app`, `rtc` и `turn` subdomain;
- firewall: TCP `80`, `443`, `7881`; UDP `3478`, `50000-60000`;
- отдельный защищённый файл секретов вне git.

`443` обслуживает и HTTPS/WSS, и TURN/TLS через SNI. Нельзя закрывать
`7881` или TURN/UDP до выполнения UDP-blocked части WT-610.

## 1. Создать LiveKit foundation

На защищённой машине администратора запустить официальный generator и выбрать
тот же major/minor server version, что закреплён в `infra/livekit/Dockerfile`
(`v1.13.3` на момент этой задачи):

```bash
docker pull livekit/generate
docker run --rm -it -v "$PWD":/output livekit/generate
```

Выбрать `LiveKit Server only`, указать `rtc.<domain>` и `turn.<domain>`, затем
перенести созданную папку на VM и поднять её по инструкции generator-а. Его
`caddy.yaml`, `livekit.yaml` и `redis.conf` — operational source of truth для
RTC/TURN. Эти файлы и их ключи не коммитятся в данный репозиторий.

До старта Caddy все три DNS-записи должны указывать на VM: иначе trusted TLS
certificate не будет выпущен.

## 2. Добавить application route

В сгенерированном `caddy.yaml`:

1. добавить реальный `app.<domain>` в `apps.tls.certificates.automate`;
2. заменить `<APP_DOMAIN>` в
   [`caddy-app-route.fragment.yaml`](caddy-app-route.fragment.yaml) реальным
   доменом и добавить route в `apps.layer4.servers.main.routes`;
3. перезапустить Caddy после проверки конфигурации.

Route ведёт на `localhost:8088`, который доступен только этому Caddy на VM.
Staging compose задаёт gateway `WT_FORWARDED_PROTO=https`, поэтому backend не
принимает подменяемый извне `X-Forwarded-Proto` и secure cookie сохраняет
правильную семантику за TLS termination. Local Compose явно задаёт `http`.
Для opt-in Internet staging вместо этого legacy route используйте
`public-caddy-app-route.fragment.yaml`: он посылает PROXY protocol v2 в
public gateway. Не ставьте оба app route для одного SNI одновременно.

## 3. Развернуть приложение

Скопировать этот репозиторий на VM и создать защищённый env-файл вне checkout:

```bash
install -m 700 -d /opt/spectemus-simul
install -m 600 infra/staging/.env.example /opt/spectemus-simul/.env
```

Заполнить `/opt/spectemus-simul/.env`:

- `WT_STAGING_APP_DOMAIN`, `WT_STAGING_RTC_DOMAIN`, `WT_STAGING_TURN_DOMAIN`;
- Redis password, LiveKit API key и API secret из generator output;
- отдельный длинный `FEEDBACK_ADMIN_TOKEN` для `/operator`.

До запуска compose выполните локальную проверку защищённого env-файла. Она не
печатает секреты, проверяет отсутствие sample-значений и требует три разных
публичных DNS-имени для application, RTC и TURN:

```bash
pnpm staging:preflight -- --env-file /opt/spectemus-simul/.env
```

Когда DNS уже направлен на выбранную VM, добавьте её публичный IPv4. Команда
проверит A-записи `app`, `rtc` и `turn`; только после зелёного результата
переходите к запуску Caddy и приложения:

```bash
pnpm staging:preflight -- \
  --env-file /opt/spectemus-simul/.env \
  --public-ipv4 <VM_PUBLIC_IPV4> \
  --verify-dns
```

Затем из корня checkout:

```bash
docker compose --env-file /opt/spectemus-simul/.env -f infra/staging/compose.yaml config --quiet
docker compose --env-file /opt/spectemus-simul/.env -f infra/staging/compose.yaml up --build -d --wait
```

Не запускайте на VM одновременно `infra/compose.yaml`: это local-only стек и
он создаст конфликтующие Redis/LiveKit ports.

## Opt-in Internet staging (SPS-729)

Этот режим предназначен только для закрытого стенда. До его включения оператор
предоставляет работающие PostgreSQL, SMTP с подтверждённым sender domain,
защищённый env-файл, VM и три DNS-имени. Compose не создаёт эти ресурсы и не
подменяет их тестовыми значениями. Заполните в том же защищённом env-файле
`PUBLIC_ACCESS_*` и `PUBLIC_LIVEKIT_API_*` из `.env.example`. Public LiveKit
credentials выдаются для сервера generator-а отдельно от LAN/dev credentials.
PostgreSQL JDBC host должен быть доступен **из backend-контейнера**; `localhost`
в JDBC URL указывает на сам контейнер и не подходит.

Сначала проверьте значения без вывода секретов и затем разрешённые Docker
Compose настройки. `--public` требует полный комплект public-настроек; без
этого ключа прежний staging preflight не изменился:

```bash
pnpm staging:preflight -- --env-file /opt/spectemus-simul/.env --public
pnpm staging:preflight -- \
  --env-file /opt/spectemus-simul/.env --public \
  --public-ipv4 <VM_PUBLIC_IPV4> --verify-dns
docker compose --env-file /opt/spectemus-simul/.env \
  -f infra/staging/compose.yaml -f infra/staging/public.compose.yaml \
  config --quiet
```

После настройки PostgreSQL, SMTP и LiveKit foundation оператор может запустить
opt-in application layer:

```bash
docker compose --env-file /opt/spectemus-simul/.env \
  -f infra/staging/compose.yaml -f infra/staging/public.compose.yaml \
  up --build -d --wait
```

Overlay передаёт backend отдельные `PUBLIC_ACCESS_*`/`PUBLIC_LIVEKIT_*`,
включает device binding и собирает frontend с
`VITE_INTERNET_ROOM_RUNTIME_ENABLED=true` и фиксированным
`VITE_INTERNET_APP_ORIGIN=https://app.<domain>`. Browser LiveKit URL приходит
только из public token ответа (`wss://rtc.<domain>`); LAN `devkey`, loopback и
заголовок `Host` не используются как fallback. Для desktop host на тестовом
компьютере отдельно требуется
`SPECTEMUS_PUBLIC_API_ORIGIN=https://app.<domain>` — это временная операторская
настройка, не готовый UX установки для конечного пользователя.

Публичный gateway принимает app-трафик только с PROXY v2 от Caddy и берёт
адрес гостя из этого протокола, а не из подделываемого клиентом
`X-Forwarded-For`. Это сохраняет per-IP rate limit для email challenge и
других public API. Healthcheck использует отдельный непубликуемый порт
контейнера. Gateway пропускает только `/api/v2/` к backend. `/api/v1/`,
`/actuator/` и `/operator/` закрыты; backend и gateway остаются привязаны к
loopback VM. Проверьте извне, что `https://app.<domain>/api/v1/rooms` и
`https://app.<domain>/actuator/health` дают 404, а `/api/v2/` доступен только
по правилам account/membership. Старый LAN-экран в этом opt-in frontend build
не должен использоваться как публичный продуктовый сценарий.

Публичный Nginx gateway отключает access/error logs в своём server-блоке:
URL комнаты и одноразовые параметры из обработанных запросов не должны
попадать в журналы контейнера. Это не
отключает логи внешнего Caddy, LiveKit, Docker daemon и backend. До открытия
стенда оператор обязан проверить их настройки на VM: журнал HTTP-запросов
`app.<domain>` должен быть выключен либо исключать полный URL, query string,
cookie, Authorization и исходный IP. Для остальных эксплуатационных логов
задайте ограниченный срок хранения и доступ только операторам; не копируйте
сырые журналы в тикеты. Без этой проверки privacy gate не пройден.

После получения доверенных TLS-сертификатов проверьте HTTPS приложения и
WSS-сигналинг `rtc.<domain>`. Отдельный сетевой прогон из двух домов должен
подтвердить ICE-подключение и медиапоток в обычной сети и при заблокированном
UDP, когда трафик действительно идёт через `turn.<domain>` по TURN/TLS.
Зелёные unit-тесты, Compose config и preflight не подтверждают этот gate.
Перед открытием доступа нужны также приватные логи, диагностика причин
разрыва и проверка нагрузки; Internet mode пока нельзя объявлять готовым.

Откат opt-in режима: остановить только application compose с обоими `-f`,
затем вернуть legacy app route Caddy и прежнюю сборку без overlay. Не удалять volumes PostgreSQL/Redis
и не трогать generator LiveKit без отдельного плана отката. Повторный запуск
только базового `compose.yaml` оставляет public flags выключенными.

## 4. Проверить WT-610

С машины оператора против публичных адресов:

```bash
WT_BETA_BASE_URL=https://app.<domain> \
WT_BETA_LIVEKIT_URL=wss://rtc.<domain> \
FEEDBACK_ADMIN_TOKEN='<staging-only-secret>' \
pnpm beta:evidence:preflight

WT_BETA_BASE_URL=https://app.<domain> \
WT_BETA_LIVEKIT_URL=wss://rtc.<domain> \
pnpm beta:smoke
```

Только после обеих зелёных команд выполняется ручная матрица из
[`docs/WT-603_BETA_EVIDENCE_RUN.md`](../../docs/WT-603_BETA_EVIDENCE_RUN.md):
Chrome/Edge, host+1/host+3, normal и UDP-blocked/TURN, 15–30 минут, QoS/cost и
triage feedback. Автоматический smoke не заменяет эти сессии.

## Rollback

Application rollback не меняет LiveKit foundation: остановить только
`infra/staging/compose.yaml`, вернуть предыдущий commit/image и повторить
`beta:smoke`. Не выполнять `down --volumes`: Redis содержит эфемерное, но
активное состояние комнат и feedback до TTL.

## Проверка этого шаблона

```bash
docker compose --env-file <protected-env> -f infra/staging/compose.yaml config --quiet
```

Дополнительно должны проходить `pnpm infra:config`, `pnpm infra:check` и
`pnpm check` для локального контура. Полный TLS/TURN test возможен только на
выделенной VM с настоящими DNS-записями.
