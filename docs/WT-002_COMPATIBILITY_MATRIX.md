# WT-002 Матрица совместимости

Цель: зафиксировать поведение браузеров, файлов и базовых сценариев для media pipeline WT-001 без тяжелой QA-бюрократии.

Scope:

- desktop Chrome и Edge;
- локальный MP4 через системный file picker;
- `HTMLVideoElement.captureStream()`;
- публикация и подписка через LiveKit;
- отсутствие загрузки файла в application backend.

## Краткое решение

| Область | Текущее решение |
|---|---|
| Основные браузеры | Desktop Chrome / Edge |
| Основной формат | MP4, H.264/AVC, AAC |
| Mobile browsers | Не входят в WT-001/WT-002 |
| Firefox/Safari | Только исследование, без MVP-обещания |
| MKV/HEVC/DTS | Не входят в MVP-путь WT-001/WT-002 |

## Матрица браузеров

| Сценарий | Результат | Подтверждение / заметки |
|---|---|---|
| Chrome host -> Chrome guest | PASS | Ручной прогон 27 минут подтвержден. |
| Edge playback | PASS | Ручной smoke-прогон Edge подтвержден. |
| Chrome host -> Edge guest | TODO | Прогнать короткий smoke после hard refresh. |
| Edge host -> Chrome guest | TODO | Прогнать короткий smoke после hard refresh. |
| Edge host -> Edge guest | TODO | Прогнать короткий smoke после hard refresh. |

## Матрица файлов

| Сценарий | Ожидаемое поведение | Результат | Заметки |
|---|---|---|---|
| MP4 H.264/AAC со звуком | Host публикует video + audio; guest получает оба трека | PASS | Основной long-run файл отработал. |
| MP4 без audio track | Host публикует video; audio status показывает отсутствие audio | TODO | Не должно считаться фатальной ошибкой. |
| Пустой файл | Host отклоняет файл с понятной ошибкой | TODO | Логика покрыта unit-тестами, нужен browser smoke. |
| Неподдерживаемый контейнер, например MKV | Host показывает предупреждение/ошибку воспроизведения | TODO | Не входит в MVP support, но ошибка должна быть понятной. |
| HEVC MP4 | Поведение зависит от браузера/ОС; поддержку не обещаем | TODO | Зафиксировать фактическое поведение Chrome/Edge. |

## Матрица взаимодействий

| Сценарий | Ожидаемое поведение | Результат | Заметки |
|---|---|---|---|
| Host play -> pause -> play | Guest видит продолжение/заморозку/возобновление stream по состоянию host source | TODO | Native pause у guest локальная и не управляет host. |
| Host seek forward/back | Guest видит скачок кадров live stream | TODO | Product-state sync не реализован в WT-001. |
| Повторный выбор файла | Старые tracks останавливаются; новый файл можно опубликовать | TODO | Проверить, что нет duplicate publications. |
| Guest reload/reconnect | Guest reconnects и подписывается на текущий host stream | TODO | Использовать тот же room URL. |
| Host reload/reconnect | Host reconnects и может republish | TODO | Проверить auto-republish behavior. |
| Stop publication | Guest теряет tracks и видит missing state | TODO | Должно восстановиться после повторного publish. |
| Network tab: no backend upload | Только token request; без file POST/PUT/multipart | PASS | Подтверждено вручную. |

## Критерии выхода WT-002

- Все обязательные Chrome/Edge строки имеют `PASS` или понятное документированное ограничение.
- Неподдерживаемые файлы дают понятную ошибку, а не молчаливый зависон.
- Известные ограничения перенесены в README перед WT-004.
