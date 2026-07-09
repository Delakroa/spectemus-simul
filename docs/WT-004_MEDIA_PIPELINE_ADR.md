# WT-004 Media Pipeline ADR

Статус: принято для MVP foundation.

Дата: 2026-07-08.

## Контекст

WT-001 доказал основной media path:

```text
host local MP4 -> HTMLVideoElement -> captureStream()
-> LiveKit audio/video tracks -> guest browser
```

WT-002 зафиксировал поддерживаемые browser и codec boundaries. WT-003 зафиксировал первый quality baseline и проверки масштаба, которые ещё нужны перед публичным обещанием качества.

Этот ADR закрывает P0-решение, нужное перед началом P1 foundation.

## Решение

Использовать native browser playback и `HTMLMediaElement.captureStream()` как основной MVP media pipeline для локальных файлов.

Использовать LiveKit как media plane для WebRTC publish, SFU fan-out, subscription и будущего TURN/TLS deployment.

Spring Boot не участвует в media byte path. Будущий backend отвечает за rooms, access, roles, room state, tokens, presence, TTL, audit и telemetry. В MVP он не должен proxy, store или transcode movie bytes.

## Поддерживаемая MVP-граница

| Область                 | Решение                                             |
| ----------------------- | --------------------------------------------------- |
| Host browser            | Desktop Chrome / Edge                               |
| Guest browser           | Desktop Chrome / Edge                               |
| File source             | Локальный файл, выбранный через browser file picker |
| Primary format          | MP4, H.264/AVC video, AAC audio                     |
| Media transport         | WebRTC через LiveKit                                |
| Backend media storage   | Нет                                                 |
| Server-side transcoding | Нет                                                 |
| Mobile, Safari, Firefox | Только research, не MVP guarantee                   |
| MKV, HEVC, DTS, DRM     | Вне MVP scope                                       |

## Граница product state

Media tracks и product state разделены.

LiveKit передает audio/video tracks. WT-004 также добавляет небольшой data-channel prototype `wt.playback-state.v1`, чтобы guest видел и применял host state `playing`, `paused` и `ended`.

Этот data-channel слой полезен как PoC evidence, но это не финальная authoritative room-state system. В MVP architecture Spring Boot WebSocket snapshots/events остаются source of truth для room state, permissions, stale event handling, reconnect snapshots и versioning.

## Fallback-стратегия

Основной fallback для неподдерживаемых файлов — понятная file/browser error, а не silent upload или server transcoding.

`getDisplayMedia()` остаётся возможным fallback для screen/tab sharing в будущем, но не входит в текущий принятый MVP file pipeline. Desktop helper или local transcoding можно рассматривать только после beta demand на более широкую file support.

## Известные последствия

- Guest получает live WebRTC stream, а не исходный VOD file.
- Host seek виден guest как live-stream jump; точная VOD timeline sync не решена в P0.
- Host pause представлен и поведением media stream, и WT-004 playback-state messages.
- Текущий baseline показал source/capture `1920x1080`, а guest decoded `1280x720`; это не блокирует P1.
- Multi-guest и degraded-network metrics всё ещё нужны перед публичным quality или scale promise.
- Browser support намеренно остаётся узкой, пока compatibility evidence не изменится.

## GO / ADJUST

Решение: `GO` для перехода к P1 foundation.

Продолжаем с принятым путем Chrome/Edge + MP4 H.264/AAC + LiveKit.

`ADJUST` перед beta:

- прогнать 2-guest и 3-guest quality checks;
- прогнать controlled network checks, если MVP обещает resilience при VPN, UDP blocking или слабом uplink;
- решить, является ли 1080p one-to-one delivery продуктовым требованием;
- перенести authoritative room/product state из LiveKit-only PoC messages в backend-owned WebSocket state.

## Подтверждения приемки

- WT-001 подтвердил local MP4 preview, capture, publish, guest video/audio, Chrome long-run, Edge smoke и отсутствие backend file upload.
- WT-002 задокументировал MVP browser/codec boundaries.
- WT-003 задокументировал first-frame, bitrate, packet loss, jitter, dropped frames и resolution observations.
- WT-004 data-channel prototype подтвердил, что host playback state может доехать до guest без backend media upload.
