# WT-622 — cross-platform LAN setup

## Цель

Сделать проверку Windows host → Mac guest воспроизводимой и диагностируемой.
До этого LAN-конфигурация требовала вручную редактировать IP в `infra/lan.env`.
Если там оставался адрес другого компьютера, invite мог открываться не там, а
LiveKit token возвращал неверный endpoint.

## Область

- Автоматически собрать `infra/lan.env` для компьютера с Docker.
- Не позволять догадаться между двумя физическими сетями: показать кандидаты и
  принять только явно переданный private IPv4.
- В opt-in LAN-режиме вернуть в LiveKit token фактический private IPv4 из
  browser `Host` header; для обычного local/staging режима оставить
  зафиксированный `LIVEKIT_URL`.
- Одной командой проверить gateway, LiveKit TCP signalling, TCP fallback и
  token response как на host, так и с guest-компьютера.

## Реализация

- `pnpm infra:lan:setup` выбирает единственный неvirtual private IPv4 и
  генерирует ignored `infra/lan.env`. Флаг `-- --ip <IPv4>` нужен лишь при
  нескольких физических сетях.
- `LIVEKIT_URL_FROM_REQUEST=true` включён только в LAN template. Backend
  подменяет host в настроенном `ws://…:7880` исключительно на числовой private
  IPv4 из `Host`; loopback, публичный IP, имя хоста и malformed header оставят
  безопасный статический URL.
- `pnpm infra:lan:doctor` без аргументов использует IP текущего `lan.env`.
  `pnpm infra:lan:doctor -- --host <IPv4>` проверяет удалённый Docker host с
  Mac/Windows guest. В проверочной комнате не печатаются и не сохраняются
  session, host secret или LiveKit token; комната закрывается после проверки.
- На Windows firewall не меняется скриптом: для этого требуются права
  администратора. Doctor показывает ровно две PowerShell-команды для профиля
  `Private`, если сеть недоступна.

## Проверки

```bash
pnpm test:lan
pnpm backend:test
pnpm infra:lan:config
pnpm infra:lan:doctor
```

Для настоящего межкомпьютерного evidence обязательна последняя команда на Mac
с `--host <Windows-private-IPv4>` и реальный host + guest просмотр.

## Ограничения и follow-up

- Doctor подтверждает HTTP/WebSocket control path и TCP fallback. UDP диапазон
  `50000–50100` нельзя доказать с одной машины: он проверяется реальной
  передачей видео между Windows и Mac.
- HTTP LAN намеренно не обещает voice chat: микрофон требует HTTPS или
  localhost.
- После этого останется WT-623: унифицировать entry page с private-review
  visual system активной комнаты.
