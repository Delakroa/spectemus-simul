# SPS-731 — серверная основа телеметрии Internet-соединения

## Цель

Подготовить агрегированные сигналы о разрывах Internet-комнаты без истории
пользователей и без идентификаторов в метриках. Клиентская отправка событий —
отдельный следующий срез: пока endpoint не вызывается автоматически.

## Контракт и поведение

- `POST /api/v2/public-rooms/{publicRoomId}/connection-telemetry` принимает
  один `type` из фиксированного списка: `CONNECTED`, `RECONNECTING`,
  `RECONNECTED`, `DISCONNECTED`, `QUALITY_POOR`, `QUALITY_LOST`.
- Требуются действующий browser account cookie или desktop device Bearer и
  активное членство в открытой комнате. Cookie имеет приоритет, как и в public
  LiveKit token API. Неавторизованным и исключённым участникам счётчик не
  увеличивается.
- Тело не принимает room/account ID, адреса, свободный текст и дополнительные
  поля. В Micrometer хранится только счётчик
  `spectemus.internet.connection.events` с одним тегом `event` из enum. Ни
  отдельные записи, ни application log событий не создаются.
- На одно обращение приходится один event; ответ `202` без тела и с
  `Cache-Control: no-store`. IP rate-limit использует отдельный
  `internet-telemetry` bucket и существующий бюджет telemetry — 60 запросов в
  минуту по умолчанию.
- Controller и service отсутствуют, если выключен `public-access` или
  `public-livekit`. Оба флага по умолчанию выключены. LAN `/api/v1/telemetry`
  и его поведение не меняются.

## Проверки

`pnpm contracts:check`, `pnpm backend:test`, `pnpm check`. Тесты проверяют
cookie/Bearer, приоритет cookie, отсутствие receipt, отсутствие счётчика до
membership check, enum-only metric tag, отказ для пустого/неизвестного события
и дополнительного `detail`, rate-limit route и disabled context.

## Границы и следующий шаг

Отправка из browser/desktop, согласие пользователя и конечный retention
метрик/логов staging вне этого тикета. До неё нельзя интерпретировать нулевые
счётчики как отсутствие проблем связи. Клиентские события также не являются
доказательством качества сети: действующий участник может отправить неточный
сигнал, поэтому это вспомогательная метрика, а не release gate. Следующий срез должен подключить только
best-effort события из Internet UI, не передавая room URL, JWT, IP или название
фильма. Реальный межсетевой прогон VM/DNS/TLS/WSS/TURN остаётся обязательным
отдельным gate перед публичным релизом.
