# WT-680 — Internet alpha staging precheck

## Статус

Завершено как repo-side guard для первого внешнего запуска. Это не public
deploy и не включает Internet mode для пользователей.

## Зачем

Первая внешняя сессия требует трёх разных точек: application, LiveKit RTC и
TURN. Раньше staging-инструкция описывала нужные значения, но не могла
автоматически остановить запуск, если в защищённом env-файле остались sample
секреты, два сервиса получили один домен или DNS ещё смотрит не на выбранную
VM. Такие ошибки опасны тем, что обнаруживаются уже после открытия портов.

## Что сделано

Добавлена команда:

```bash
pnpm staging:preflight -- --env-file /opt/spectemus-simul/.env
```

Она читает только указанный защищённый env-файл и не выводит его значения. До
запуска проверяются:

- наличие трёх разных публичных имён `app`, `rtc`, `turn`;
- отсутствие стандартных `example`, `replace`, placeholder и коротких
  секретов для Redis, LiveKit и feedback operations;
- корректность структуры env-файла без повторяющихся переменных.

После настройки DNS оператор выполняет ещё одну проверку:

```bash
pnpm staging:preflight -- \
  --env-file /opt/spectemus-simul/.env \
  --public-ipv4 <VM_PUBLIC_IPV4> \
  --verify-dns
```

Она подтверждает, что A-record каждого из трёх доменов указывает на одну
выбранную публичную VM. Private, loopback и служебные IP нельзя принять за
адрес public alpha.

## Граница задачи

Проверка намеренно ничего не создаёт и не открывает: не покупает домен или VM,
не записывает DNS, не запускает контейнеры и не получает TLS certificate.
После неё всё ещё нужны Caddy/LiveKit generator, firewall, HTTPS/TURN и
реальный smoke из двух разных сетей по [WT-610](WT-610_STAGING_BOOTSTRAP.md).
Только затем можно переходить к account/invite runtime из
[WT-652](WT-652_INTERNET_MODE_ARCHITECTURE.md). LAN mode не меняется.

## Проверка

```bash
pnpm test:staging
pnpm format:staging
```
