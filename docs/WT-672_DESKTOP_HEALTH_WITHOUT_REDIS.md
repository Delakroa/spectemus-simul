# WT-672 — desktop health без Redis

## Инцидент

Windows desktop preview запускал backend, но `/actuator/health` отвечал `503`.
Из-за этого окно показывало «Сервис не стал доступен», хотя пользователь не
должен запускать Docker или Redis.

Desktop profile уже отключал Redis auto-configuration для room storage и rate
limiter, но Actuator Redis health contributor оставался включённым и проверял
несуществующий `127.0.0.1:6379`.

## Исправление

В desktop profile отключён только Redis health contributor. Backend health
остаётся доступным для supervisor, а desktop host продолжает работать на
in-memory runtime без Docker и Redis.

## Проверка

Запуск backend с `desktop` profile без Redis возвращает `200` и `UP` на
`/actuator/health`.
