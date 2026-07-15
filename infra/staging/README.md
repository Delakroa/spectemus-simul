# WT-610 staging bootstrap

Этот каталог готовит application layer для **одного Linux VM** с официальным
production generator LiveKit. Он не разворачивает сервер сам и не содержит
сертификатов, DNS-записей или секретов.

## Принятое разделение

```text
app.<domain>  ── TLS ─┐
rtc.<domain>  ── TLS ─┼─ Caddy из official LiveKit generator ─┐
turn.<domain> ── TLS ─┘                                      ├─ LiveKit / embedded TURN
                                                              └─ 127.0.0.1:8088 Watch Together gateway
```

`infra/staging/compose.yaml` запускает только backend и gateway. LiveKit,
Caddy, TURN/TLS и Redis создаются отдельно official generator-ом LiveKit;
так не появляется самодельная и неподдерживаемая TURN-конфигурация.

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

## 3. Развернуть приложение

Скопировать этот репозиторий на VM и создать защищённый env-файл вне checkout:

```bash
install -m 700 -d /opt/watch-together
install -m 600 infra/staging/.env.example /opt/watch-together/.env
```

Заполнить `/opt/watch-together/.env`:

- `WT_STAGING_APP_DOMAIN`, `WT_STAGING_RTC_DOMAIN`;
- Redis password, LiveKit API key и API secret из generator output;
- отдельный длинный `FEEDBACK_ADMIN_TOKEN` для `/operator`.

Затем из корня checkout:

```bash
docker compose --env-file /opt/watch-together/.env -f infra/staging/compose.yaml config
docker compose --env-file /opt/watch-together/.env -f infra/staging/compose.yaml up --build -d --wait
```

Не запускайте на VM одновременно `infra/compose.yaml`: это local-only стек и
он создаст конфликтующие Redis/LiveKit ports.

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
docker compose --env-file <protected-env> -f infra/staging/compose.yaml config
```

Дополнительно должны проходить `pnpm infra:config`, `pnpm infra:check` и
`pnpm check` для локального контура. Полный TLS/TURN test возможен только на
выделенной VM с настоящими DNS-записями.
