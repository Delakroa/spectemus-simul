# SPS-729 — opt-in Internet staging transport

## Цель

Соединить уже реализованный Internet room runtime с отдельным staging
application layer для будущего HTTPS/WSS/TURN-прогона. Это подготовка
репозитория, а не подтверждение просмотра между городами: реальные PostgreSQL,
SMTP, VM, DNS, сертификаты и TURN предоставляет оператор.

## Решение

- Базовый `infra/staging/compose.yaml` остаётся без public flags. Только
  `public.compose.yaml` включает public access, device binding, public LiveKit
  и Internet frontend build. Backend public URL и frontend origin собираются
  из одних `app`/`rtc` доменов, а не из клиентского `Host` или LAN defaults.
- Public gateway пропускает к backend только `/api/v2/`. LAN `/api/v1/`,
  `/actuator/` и `/operator/` закрыты на публичном маршруте. Backend и gateway
  остаются на loopback VM.
- Отдельный app route Caddy посылает PROXY v2; public Nginx принимает только
  этот формат и передаёт backend реальный client IP из PROXY protocol вместо
  доверия клиентскому `X-Forwarded-For`. Отдельный внутренний порт обслуживает
  healthcheck. Legacy app route остаётся для базового staging. Формат связки
  следует [документации Caddy layer4](https://github.com/mholt/caddy-l4/blob/master/docs/handlers/proxy.md)
  и [документации NGINX](https://docs.nginx.com/nginx/admin-guide/load-balancer/using-proxy-protocol/).
- `staging:preflight -- --public` проверяет обязательные настройки PostgreSQL,
  SMTP и public LiveKit без вывода их значений. Предыдущий режим preflight без
  `--public` не меняется. DNS-проверка остаётся явной опцией.
- TURN/TLS создаётся официальным LiveKit generator; в репозитории не появляются
  собственный TURN-сервер, сертификаты или секреты.

## Проверка

```bash
pnpm test:staging
pnpm staging:preflight -- --env-file <protected-env> --public
docker compose --env-file <protected-env> \
  -f infra/staging/compose.yaml -f infra/staging/public.compose.yaml config --quiet
pnpm check
```

Тесты проверяют отключённый default, обязательные public-поля, sample/dev
credentials, плохой JDBC URL, блокировку LAN/служебных маршрутов и связку
Caddy PROXY v2 → Nginx client IP. Полный
сетевой gate на реальной VM описан в `infra/staging/README.md` и **не может**
быть засчитан результатом CI.

## Откат и ограничения

Снять `public.compose.yaml` из команды запуска и вернуть исходную сборку
application layer. Данные PostgreSQL/Redis и generator LiveKit этим действием
не удаляются. Отдельно остаются реальные DNS/TLS/WSS/TURN, межсетевой прогон,
privacy-safe диагностика и удобная настройка public origin в установленном
desktop-приложении. Пока эти gate не закрыты, Internet mode не готов для
пользователей.
