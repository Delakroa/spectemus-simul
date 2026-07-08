# WT-002 Матрица совместимости

Цель: коротко зафиксировать факты по браузерам, файлам и базовым действиям для media pipeline `local MP4 -> captureStream() -> LiveKit -> guest`.

## Статус

Матрица закрывает границы MVP, а не заменяет полноценный QA-план.

- `PASS` — подтверждено вручную, кодом или unit-тестом.
- `LIMITATION` — сознательное ограничение текущего PoC/MVP.
- `NOT RUN` — отдельный прогон нужен перед тем, как обещать это как продуктовую гарантию.

## Область проверки

| Область | Решение |
|---|---|
| Основные браузеры | Desktop Chrome / Edge |
| Основной формат | MP4, H.264/AVC, AAC |
| Mobile browsers | `LIMITATION`: не входят в WT-001/WT-002 |
| Firefox/Safari | `LIMITATION`: только исследование, без MVP-обещания |
| MKV/HEVC/DTS | `LIMITATION`: не входят в MVP-путь |
| Загрузка на backend | Файл не загружается на application backend |

## Браузеры

| Сценарий | Результат | Факт / заметка |
|---|---|---|
| Chrome host -> Chrome guest | PASS | Ручной прогон 27 минут подтвержден: видео и звук не отвалились. |
| Edge playback smoke | PASS | Ручной smoke-прогон в Edge подтвержден. |
| Chrome host -> Edge guest | NOT RUN | Нужен короткий cross-browser smoke перед публичным обещанием одинакового поведения Chrome/Edge. |
| Edge host -> Chrome guest | NOT RUN | Нужен короткий cross-browser smoke перед публичным обещанием одинакового поведения Chrome/Edge. |
| Edge host -> Edge guest | NOT RUN | Нужен короткий Edge-only smoke именно с Edge host. |

## Файлы

| Сценарий | Ожидаемое поведение | Результат | Факт / заметка |
|---|---|---|---|
| MP4 H.264/AAC со звуком | Host публикует video + audio; guest получает оба трека | PASS | Основной long-run файл отработал. |
| MP4 без audio track | Host публикует video; audio status показывает отсутствие audio | PASS | Код разрешает video-only publish; unit-тест покрывает отсутствие audio track. |
| Пустой файл | Host отклоняет файл с понятной ошибкой | PASS | `replaceFile()` показывает `Selected file is empty`; publish не стартует. |
| Неподдерживаемый контейнер | Host показывает ошибку воспроизведения браузера | LIMITATION | File picker ограничен `video/mp4`; вне MP4 не обещаем MVP support. |
| HEVC MP4 | Поведение зависит от браузера/ОС | LIMITATION | Поддержку HEVC не обещаем; основной MVP-формат — H.264/AAC MP4. |

## Действия

| Сценарий | Ожидаемое поведение | Результат | Факт / заметка |
|---|---|---|---|
| Host play -> pause -> play | Host управляет источником; guest видит live stream текущего состояния | PASS | Управление находится у host. Guest pause/play не является product-control. |
| Host seek forward/back | Guest видит скачок кадров live stream | PASS | Работает как следствие captureStream от host video element; авторитетной синхронизации еще нет. |
| Повторный выбор файла | Старые tracks останавливаются; новый файл можно опубликовать | PASS | Код вызывает `stopPublication({ resetIntent: true })`, очищает object URL и captured state. |
| Guest reload/reconnect | Guest reconnects и подписывается на текущий host stream | PASS | Подтверждено вручную во время отладки reconnect/subscription. |
| Host reload/reconnect | Host reconnects и может republish | PASS | Есть auto-republish после `Reconnected` и `LocalTrackUnpublished`; ручной `Publish` остается fallback. |
| Stop publication | Guest теряет tracks и видит missing state | PASS | Код отписывает tracks через `unpublishTrack(track, true)` и сбрасывает state. |
| Network tab: no backend upload | Только token request; без file POST/PUT/multipart | PASS | Подтверждено вручную; media идет через LiveKit/WebRTC, не через application upload. |

## Вывод WT-002

`GO` для продолжения MVP на базе Chrome/Edge + MP4 H.264/AAC.

Перед публичным обещанием широкой совместимости нужно отдельно прогнать cross-browser пары Chrome/Edge и решить, расширяем ли support за пределы H.264/AAC MP4.
