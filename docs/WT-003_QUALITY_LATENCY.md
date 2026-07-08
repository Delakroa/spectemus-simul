# WT-003 Качество и задержка

Цель: понять, достаточно ли устойчив путь `captureStream() -> LiveKit -> guest`, чтобы на нем строить MVP foundation.

## Что измеряет PoC

Guest page теперь показывает:

- первый кадр после нажатия `Connect` у guest;
- playback quality через `HTMLVideoElement.getVideoPlaybackQuality()`;
- video receiver stats из LiveKit/WebRTC;
- audio receiver stats из LiveKit/WebRTC.

Текущий PoC пока не измеряет настоящую host-to-guest wall-clock media latency, потому что host playback timestamps не отправляются как authoritative room events. Это относится к будущему слою product-state/WebSocket.

## Метрики для фиксации

| Метрика | Источник | Заметки |
|---|---|---|
| Time to first frame | Guest UI `First frame` | Миллисекунды после нажатия `Connect` у guest. |
| Video bitrate | Guest UI `Video stats` | Считается по delta receiver `bytesReceived`. |
| Audio bitrate | Guest UI `Audio stats` | Считается по delta receiver `bytesReceived`. |
| Packet loss | Guest UI `Video stats` / `Audio stats` | На локальном тесте должен быть около нуля. |
| Jitter | Guest UI `Video stats` / `Audio stats` | Показывается в ms. |
| Dropped frames | Guest UI `Playback` | Смотреть процент dropped frames во время длинного playback. |
| Resolution | Guest UI `Video stats` | Подтверждает размер получаемого кадра. |
| Source resolution | Host UI `Source resolution` | Фактическое разрешение выбранного файла после загрузки metadata. |
| Capture resolution | Host UI `Capture resolution` | Разрешение video track, которое отдал `captureStream()`. |
| Received resolution | Guest UI `Video stats` | Разрешение video track, которое реально декодирует guest. |
| First frame after reconnect | Guest UI `First frame` после reconnect | Прогнать после reload/reconnect. |

## Локальные baseline-прогоны

| Сценарий | First frame | Video bitrate | Audio bitrate | Packet loss | Jitter | Dropped frames | Результат |
|---|---:|---:|---:|---:|---:|---:|---|
| 1 guest, Chrome -> Chrome | 6209 ms | 2.55 Mbps | 99 kbps | 0 | video 1 ms / audio 0 ms | 32 / 2455, 1.3% | PASS, стабильное воспроизведение; зафиксирован downscale разрешения |
| 1 guest, Edge playback | TODO | TODO | TODO | TODO | TODO | TODO | PASS playback smoke |
| 2 guests | TODO | TODO | TODO | TODO | TODO | TODO | TODO |
| 3 guests | TODO | TODO | TODO | TODO | TODO | TODO | TODO |

## Наблюдения по разрешению

| Сценарий | Source resolution | Capture resolution | Guest received resolution | Решение |
|---|---:|---:|---:|---|
| 1 guest, Chrome -> Chrome | 1920x1080 | 1920x1080 @ 60 fps | 1280x720 | Оставляем как текущее поведение PoC; 1:1 resolution tuning не блокирует WT-003. |

Вывод: выбранный файл и `captureStream()` доходят до 1080p, но guest декодирует 720p. Вероятное место downscale — browser/WebRTC encoder/receiver участок, а не чтение файла и не `captureStream()`.

Пока не форсируем 1:1. Для MVP важнее стабильность, отсутствие packet loss, приемлемый first frame и поведение при 1/2/3 guests. Возврат к 1080p one-to-one возможен отдельной настройкой encoder parameters/bitrate/viewport, если метрики покажут, что это нужно и не ломает стабильность.

## Прогоны с ухудшением условий

| Сценарий | Ожидаемое поведение | Результат | Заметки |
|---|---|---|---|
| Guest reload | Guest reconnects и снова получает tracks | TODO | |
| Host reload | Host может reconnect и republish | TODO | |
| Короткий network drop | LiveKit reconnects или показывает понятный failure | TODO | |
| UDP blocked / TCP fallback | Соединение работает или ограничение документировано | TODO | Нужна подходящая среда. |
| VPN enabled | Работает или ограничение документировано | TODO | |

## Первичные локальные пороги

Это начальные local-PoC thresholds, не production SLO:

| Метрика | Green | Warn |
|---|---:|---:|
| First frame | <= 3000 ms | > 5000 ms |
| Packet loss | 0 | > 0 sustained |
| Jitter | <= 30 ms | > 30 ms sustained |
| Dropped frames | <= 5% | > 5% sustained |

## Критерии выхода WT-003

- Зафиксированы метрики для 1, 2 и 3 guests.
- Reconnect behavior воспроизводим.
- Для каждого quality failure есть понятная reproduction note.
- Перед WT-004 записана рекомендация `GO / ADJUST / STOP`.
