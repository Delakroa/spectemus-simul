# WT-003 Качество и задержка

Цель: понять, достаточно ли устойчив путь `captureStream() -> LiveKit -> guest`, чтобы строить поверх него MVP foundation.

## Что измеряет PoC

Guest page после подписки показывает:

- первый кадр после нажатия `Connect` у guest;
- playback quality через `HTMLVideoElement.getVideoPlaybackQuality()`;
- video receiver stats из LiveKit/WebRTC;
- audio receiver stats из LiveKit/WebRTC.

Host page показывает:

- `Source resolution` — разрешение выбранного файла после загрузки metadata;
- `Capture resolution` — разрешение video track, который отдал `captureStream()`.

Текущий PoC пока не измеряет настоящую host-to-guest wall-clock media latency. Для этого нужен отдельный product-state слой, где host timestamp отправляется как authoritative room event.

## Метрики

| Метрика | Источник | Заметки |
|---|---|---|
| Time to first frame | Guest UI `First frame` | Миллисекунды после нажатия `Connect` у guest. |
| Video bitrate | Guest UI `Video stats` | Считается по delta receiver `bytesReceived`. |
| Audio bitrate | Guest UI `Audio stats` | Считается по delta receiver `bytesReceived`. |
| Packet loss | Guest UI `Video stats` / `Audio stats` | На локальном тесте должен быть около нуля. |
| Jitter | Guest UI `Video stats` / `Audio stats` | Показывается в ms. |
| Dropped frames | Guest UI `Playback` | Смотреть процент dropped frames во время длинного playback. |
| Resolution | Host + Guest UI | Сравнить source/capture на host и received/decode на guest. |

## Baseline-прогоны

| Сценарий | First frame | Video bitrate | Audio bitrate | Packet loss | Jitter | Dropped frames | Результат |
|---|---:|---:|---:|---:|---:|---:|---|
| 1 guest, Chrome -> Chrome | 6209 ms | 2.55 Mbps | 99 kbps | 0 | video 1 ms / audio 0 ms | 32 / 2455, 1.3% | PASS, стабильное воспроизведение; зафиксирован downscale разрешения |
| 1 guest, Edge playback | не снималось | не снималось | не снималось | не снималось | не снималось | не снималось | PASS smoke; детальные метрики не снимались |
| 2 guests | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | Нужен короткий ручной прогон перед выводом о scale |
| 3 guests | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | Нужен короткий ручной прогон перед выводом о scale |

## Наблюдения по разрешению

| Сценарий | Source resolution | Capture resolution | Guest received resolution | Решение |
|---|---:|---:|---:|---|
| 1 guest, Chrome -> Chrome | 1920x1080 | 1920x1080 @ 60 fps | 1280x720 | Оставляем как текущее поведение PoC; 1:1 resolution tuning не блокирует WT-003. |

Вывод: выбранный файл и `captureStream()` доходят до 1080p, но guest декодирует 720p. Вероятное место downscale — browser/WebRTC encoder/receiver участок, а не чтение файла и не `captureStream()`.

Пока не форсируем 1:1. Для MVP важнее стабильность, отсутствие packet loss, приемлемый first frame и поведение при 1/2/3 guests. Возврат к 1080p one-to-one возможен отдельной настройкой encoder parameters/bitrate/viewport, если метрики покажут, что это нужно и не ломает стабильность.

## Reconnect / degradation

| Сценарий | Ожидаемое поведение | Результат | Заметки |
|---|---|---|---|
| Guest reload | Guest reconnects и снова получает tracks | PASS | Подтверждено во время ручной отладки guest reconnect/subscription. |
| Host reconnect | Host может reconnect и republish | PASS | Есть auto-republish после LiveKit reconnect/unpublish событий; ручной `Publish` остается fallback. |
| Короткий network drop | LiveKit reconnects или показывает понятный failure | NOT RUN | Нужна отдельная controlled network проверка. |
| UDP blocked / TCP fallback | Соединение работает или ограничение документировано | NOT RUN | Нужна подходящая среда. |
| VPN enabled | Работает или ограничение документировано | NOT RUN | Нужна подходящая среда. |

## Первичные локальные пороги

Это начальные local-PoC thresholds, не production SLO:

| Метрика | Green | Warn |
|---|---:|---:|
| First frame | <= 3000 ms | > 5000 ms |
| Packet loss | 0 | > 0 sustained |
| Jitter | <= 30 ms | > 30 ms sustained |
| Dropped frames | <= 5% | > 5% sustained |

## Вывод WT-003

`GO` для продолжения WT-004/product-state прототипа: media path стабилен на 1 guest, звук работает, packet loss равен 0, long-run 27 минут подтвержден.

`ADJUST` перед продуктовым обещанием качества/масштаба:

- снять метрики для 2 guests и 3 guests;
- отдельно решить, нужен ли 1080p one-to-one или текущий 720p received достаточно хорош для MVP;
- провести controlled network checks, если MVP должен переживать VPN/UDP blocking/нестабильную сеть.

Решение на сейчас: не трогаем 1:1 resolution tuning в этой ветке, потому что текущий стабильный baseline важнее преждевременного форса качества.
