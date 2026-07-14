# WT-619 — Native media capability foundation

## Статус

Завершено.

## Цель

Перевести выбор локального фильма из неявной «попробуйте любой `video/*`» границы в предсказуемую browser-native compatibility policy. Host до публикации должен видеть, какие контейнеры поддерживает продукт, какой файл выбран, и получать понятную причину отказа без передачи байтов файла на backend.

Это первый шаг к личному сценарию «посмотреть свой фильм вдвоём»: host выбирает законно доступный локальный файл, а guest подключается по ссылке и не скачивает этот файл.

## Область

| Семейство | Вход file picker                           | Целевые кодеки | Runtime-проверка                               |
| --------- | ------------------------------------------ | -------------- | ---------------------------------------------- |
| MP4 / M4V | `.mp4`, `.m4v`, `video/mp4`, `video/x-m4v` | H.264 + AAC    | `canPlayType()` → metadata → `captureStream()` |
| WebM      | `.webm`, `video/webm`                      | VP8/VP9 + Opus | `canPlayType()` → metadata → `captureStream()` |

Именно runtime-проверка браузера остаётся авторитетной: расширение и MIME определяют policy, а загрузка metadata подтверждает, что конкретный файл и его кодек действительно декодируются в текущем браузере.

## Не входит в тикет

- обещание поддержки «любого видео»;
- MKV, AVI, MOV, HEVC/H.265, DTS и другие контейнеры/кодеки вне browser-native policy;
- DRM-защищённые фильмы, URL внешних стриминговых сервисов, торренты и каталог контента;
- отправка или хранение movie bytes на backend;
- mobile/Safari/Firefox readiness;
- большой редизайн room workspace — это отдельный WT-620;
- desktop helper с расширенной codec support — отдельный последующий этап.

## Реализация

- `frontend/src/features/rooms/file-diagnostics.ts` содержит единую policy: `LOCAL_MEDIA_FILE_ACCEPT`, формат MP4/M4V или WebM и пользовательскую подсказку.
- Неизвестный контейнер отклоняется до попытки публикации; допустимый контейнер проходит `canPlayType()`, загрузку metadata, короткий muted decode preview до первого кадра и `captureStream()`.
- Preflight требует video track из `captureStream()` и определяет наличие audio track по фактическому stream; все временные tracks останавливаются, а диагностический video element очищается.
- `FileDiagnosticsResult` несёт нормализованные `format`, `formatLabel`, разрешение, наличие звука и verdict `CAN_STREAM`; карточка выбранного файла показывает их до кнопки публикации.
- File picker предлагает только MP4/M4V и WebM, но диагностика остаётся вторым уровнем защиты для выбора через «Все файлы» или недостоверного MIME.
- Ошибка metadata прямо сообщает о повреждённом файле или неподдерживаемом кодеке и даёт путь к совместимым форматам.

## Проверка

```bash
pnpm --filter @watch-together/frontend exec vitest run src/features/rooms/file-diagnostics.test.ts src/features/rooms/file-publication.test.ts src/features/rooms/use-room-session-host-controls.test.tsx src/pages/HomePage.test.tsx
pnpm --filter @watch-together/frontend typecheck
pnpm check
```

Автотесты покрывают MP4, M4V, WebM, недопустимый контейнер, browser rejection, недоступный `captureStream()`, metadata failure, отсутствие audio/video track в capture preview и отображение policy/verdict в UI.

Перед внешним обещанием WebM необходим отдельный staging evidence: Chrome/Edge host + guest, реальный MP4 и реальный WebM, video/audio, play/pause/seek и reconnect. До этого policy означает корректную product boundary и runtime diagnostics, а не готовность всех браузеров и кодеков.

## Известные ограничения и следующий шаг

- `captureStream()` ограничивает поддерживаемые браузеры desktop Chrome/Edge.
- `canPlayType()` не извлекает codec profile из контейнера; окончательное решение по конкретному файлу дают browser metadata load и короткий decode/capture preflight, но UI не притворяется полноценным codec inspector.
- Локальный файл остаётся только у host, поэтому его способность декодировать и отправлять поток остаётся частью качества сессии.
- После завершения WT-619 следующий продуктовый шаг — WT-620: приватный review workspace с большим media stage, правой rail и компактными controls. Расширение за пределы browser-native codecs требует отдельного desktop helper, а не скрытого обхода ограничений web-платформы.
