# WT-004 Синхронизация product-state

Цель: добавить первый product-state слой поверх уже работающего media pipeline. Host становится авторитетным источником состояния просмотра, guest получает это состояние через LiveKit data channel.

Связанное P0-решение по media pipeline зафиксировано отдельно: [WT-004 Media Pipeline ADR](WT-004_MEDIA_PIPELINE_ADR.md).

## Что реализовано

Host отправляет reliable data messages в LiveKit topic `wt.playback-state.v1`.

Для этого host token получает LiveKit grant `canPublishData: true`. Guest token оставлен без права публиковать data messages.

Сообщение содержит:

| Поле | Значение |
|---|---|
| `revision` | Монотонный номер состояния host страницы. |
| `event` | Причина отправки: `metadata`, `play`, `pause`, `seek`, `heartbeat`, `publish`, `stop`, `participant`, `reconnect`. |
| `status` | `idle`, `ready`, `playing`, `paused`, `ended`. |
| `currentTime` | Текущая позиция host video element. |
| `duration` | Длительность файла, если известна. |
| `sentAt` | Время отправки сообщения. |
| `fileName` | Имя выбранного локального файла, без загрузки файла на backend. |

Host отправляет состояние:

- при загрузке metadata;
- при play/pause;
- после seek;
- после publish/stop;
- после reconnect;
- когда в комнату входит новый participant;
- раз в секунду heartbeat, чтобы guest после reload/reconnect получил свежий state без отдельного backend.

Guest:

- слушает `RoomEvent.DataReceived`;
- принимает только topic `wt.playback-state.v1`;
- валидирует payload;
- показывает `Host playback` в правой панели;
- применяет `playing` как `remoteVideo.play()`;
- применяет `paused` и `ended` как локальный `remoteVideo.pause()`.

## Важное ограничение

Текущий media stream остается live WebRTC stream. Guest не может честно `seek`-нуться в remote media stream по `host.currentTime`, потому что у него нет файла и нет VOD timeline. Поэтому WT-004 v1 синхронизирует состояние и намерение host, а не делает точную VOD-синхронизацию по timestamp.

Это PoC-слой, а не финальный backend-owned room state. В MVP авторитетное состояние комнаты должно жить в Spring Boot WebSocket snapshot/events с versioning, permissions и stale-event handling.

Практический смысл:

- play/pause уже управляются host как авторитетным участником;
- seek у host виден guest как скачок live stream и как новое значение `Host playback`;
- после guest reload/reconnect актуальное состояние доезжает через heartbeat;
- точная компенсация задержки и wall-clock sync остаются отдельной задачей после MVP state layer.

## Как проверить вручную

1. Запусти host и guest в одной комнате.
2. На host выбери MP4 и нажми `Publish captured tracks`.
3. На guest проверь, что появилось `Host playback`.
4. На host нажми `Pause`: guest должен остановить remote video, а `Host playback` показать `paused`.
5. На host нажми `Play`: guest должен продолжить playback, а `Host playback` показать `playing`.
6. На host сделай seek: guest должен увидеть скачок live stream, а `Host playback` должен обновить time/revision.
7. Перезагрузи guest страницу: после connect он должен получить свежее состояние от host heartbeat.

## Ручная проверка

| Сценарий | Результат | Заметки |
|---|---|---|
| Host отправляет state, guest получает state | PASS | `Host playback` на guest показывает `host-...: playing/paused @ ...; rev=...`. |
| Host pause -> guest | PASS | Guest получает `paused`; remote video становится на паузу. |
| Host play -> guest | PASS | Guest получает `playing`; remote video продолжает playback. |
| Host seek -> guest | PASS | После seek guest показывает актуальный live stream, `Host playback` обновляет время и revision. |
| Guest reload/reconnect | PASS | После reload/reconnect guest снова получает текущее состояние host через heartbeat. |

## Критерий выхода WT-004 v1

- Host state messages отправляются через LiveKit data channel.
- Guest принимает и отображает host playback state.
- Host play/pause применяются на guest.
- Guest reload/reconnect получает новое состояние без backend persistence.
- Существующий media pipeline WT-001/WT-003 не регрессирует.
