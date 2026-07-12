# WT-507 Capacity test

## Статус

Завершено для MVP capacity: автоматизированы host + 1/2/3 guest и отказ сверх лимита; CPU/RAM/network оформлены как runbook перед beta.

## Цель

Подтвердить честный safe limit MVP перед WT-508 beta deployment: одна комната рассчитана на host + до трёх guest. Пятый участник не должен попасть в комнату, а заполненная комната должна оставаться управляемой для уже подключённых участников.

## Что автоматизировано

- Playwright multi-context сценарий `capacity.spec.ts`:
  - host создаёт комнату;
  - guest 1 входит, все активные клиенты видят `2/4`;
  - guest 2 входит, все активные клиенты видят `3/4`;
  - guest 3 входит, все активные клиенты видят `4/4`;
  - chat от host доходит до всех трёх гостей;
  - chat от третьего guest доходит до host и остальных гостей;
  - guest 4 получает user-facing ошибку `ROOM_FULL` и не попадает в room view;
  - заполненная комната остаётся на `4/4`.

## Команды

Перед запуском поднять полный локальный стек:

```bash
pnpm infra:up
pnpm test:e2e:capacity
```

Полный E2E-набор остаётся отдельной командой:

```bash
pnpm test:e2e
```

## Runbook CPU/RAM/network

Эта часть не включена в `check:ci`: она зависит от машины, браузера, Docker runtime и реального media profile.

| Профиль             | Как проверять                                                                                    | Ожидаемый результат                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 1 guest             | host публикует 720p/1080p MP4, один guest смотрит 15 минут; снять `docker stats` и browser stats | room управляемая, WS connected, нет роста памяти без стабилизации            |
| 2 guests            | тот же файл, два независимых guest context/browser                                               | качество не хуже `warning` кратковременно; chat/control события доходят всем |
| 3 guests            | тот же файл, три независимых guest context/browser                                               | подтверждён максимальный MVP room size; UI остаётся responsive               |
| Заполненная комната | попытка входа четвёртого guest после host + 3 guest                                              | HTTP 409 `ROOM_FULL`, UI показывает понятную ошибку                          |
| CPU/RAM sampling    | `docker stats`, Activity Monitor/Task Manager, Chrome task manager                               | нет runaway-процессов; backend/gateway/LiveKit не уходят в restart loop      |
| Network sampling    | LiveKit stats/quality indicators, DevTools/WebRTC internals, uplink host                         | bottleneck явно виден как качество media, а не падение room lifecycle        |

## Safe limits

- Публичный лимит MVP: **одна комната = host + максимум 3 guest** (`4/4`).
- Backend уже применяет этот лимит атомарно в Redis join operation и возвращает `409 ROOM_FULL`.
- Автотест WT-507 подтверждает capacity на уровне product flow: REST join, cookies, room WebSocket fan-out, UI presence, chat и Error UX.
- Реальный media quality для 3 guests зависит от uplink host-а, кодека, разрешения, LiveKit path и NAT/TURN. Для beta это публикуется как ограничение, а не как performance guarantee.

## Scaling trigger

Расширять лимит выше `4/4` нельзя без отдельного тикета, если выполняется хотя бы одно условие:

- p95 join latency или delivery chat/control events заметно деградирует на 3 guests;
- host uplink не держит выбранный bitrate без постоянного `poor` quality;
- LiveKit/TURN трафик становится главным cost/risk factor;
- backend metrics показывают рост reconnect/close/error counters при заполненных комнатах;
- CPU/RAM sampling показывает runaway или нестабильную память на 15+ минутной сессии.

Следующий технический шаг для масштабирования: отдельный load/media benchmark с фиксированным видеофикстуром, сбором WebRTC stats, Prometheus snapshot и профилями сети из WT-504.

## Реализация

- `e2e/tests/capacity.spec.ts` — automated capacity E2E.
- `e2e/tests/support/room-flow.ts` — helper `submitJoinRoom` для negative join flow.
- `e2e/package.json` и root `package.json` — добавлен `test:e2e:capacity`.

## Проверка

```bash
pnpm install --frozen-lockfile
pnpm --filter @watch-together/e2e run e2e:install
pnpm infra:up
pnpm test:e2e:capacity
pnpm test:e2e
pnpm format:check
```

Локально в задаче проверено:

- workspace dependencies установлены по lockfile;
- Playwright Chromium установлен;
- `pnpm infra:up` поднял healthy stack на `http://127.0.0.1:8088`;
- `pnpm test:e2e:capacity` прошёл: 1 тест, Chromium, `1 passed`;
- contracts check, targeted Prettier check, `git diff --check` и backend tests прошли.

## Известные ограничения

- Automated WT-507 не доказывает media QoS под нагрузкой: он проверяет product capacity, presence, chat и отказ сверх лимита.
- CPU/RAM/network baseline требует ручного прогона на целевой машине и сохранения evidence перед invite-only beta.
- `test:e2e:capacity` зависит от поднятого stack на `http://127.0.0.1:8088` и установленного Chromium (`pnpm --filter @watch-together/e2e run e2e:install`).
