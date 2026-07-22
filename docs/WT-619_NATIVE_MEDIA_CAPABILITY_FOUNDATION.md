# WT-619 — Native media capability foundation

## Статус

Завершено.

## Цель

Перевести выбор локального фильма из неявной «попробуйте любой `video/*`» границы в предсказуемую browser-native compatibility policy. Host до публикации должен видеть, какие контейнеры поддерживает продукт, какой файл выбран, и получать понятную причину отказа без передачи байтов файла на backend.

Это первый шаг к личному сценарию «посмотреть свой фильм вдвоём»: host выбирает законно доступный локальный файл, а guest подключается по ссылке и не скачивает этот файл.

## Область

| Уровень          | Семейство                                      | Вход file picker                             | Runtime-проверка                                                |
| ---------------- | ---------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------- |
| Базовая гарантия | MP4 / M4V (H.264 + AAC), WebM (VP8/VP9 + Opus) | Явный выбор и drag-and-drop                  | `canPlayType()` → metadata → `captureStream()`                  |
| Эксперимент      | MOV, MKV, AVI и другой локальный файл          | Любой `video/*` и известные video extensions | metadata → фактический decode первого кадра → `captureStream()` |

Именно runtime-проверка браузера остаётся авторитетной: базовая policy
использует расширение и MIME, а экспериментальный путь подтверждает конкретный
файл фактическим decode/capture в текущем браузере.

## Не входит в тикет

- обещание поддержки «любого видео»;
- обещание, что MOV, MKV, AVI, HEVC/H.265, DTS или любой другой контейнер
  пройдёт на каждом компьютере;
- DRM-защищённые фильмы, URL внешних стриминговых сервисов, торренты и каталог контента;
- отправка или хранение movie bytes на backend;
- mobile/Safari/Firefox readiness;
- большой редизайн room workspace — это отдельный WT-620;
- desktop helper с расширенной codec support — отдельный последующий этап.

## Реализация

- `frontend/src/features/rooms/file-diagnostics.ts` содержит единую policy: `LOCAL_MEDIA_FILE_ACCEPT`, базовые форматы и пользовательскую подсказку.
- Базовый формат проверяется через `canPlayType()`. Контейнер вне базовой policy не получает ложного отказа по расширению: он проходит загрузку metadata, короткий muted decode preview до первого кадра и `captureStream()`. Успех явно помечается как экспериментальный и привязан к устройству host-а.
- Preflight требует video track из `captureStream()` и определяет наличие audio track по фактическому stream; все временные tracks останавливаются, а диагностический video element очищается.
- `FileDiagnosticsResult` несёт нормализованные `format`, `formatLabel`, разрешение, наличие звука и verdict `CAN_STREAM`; карточка выбранного файла показывает их до кнопки публикации.
- File picker предлагает все видеофайлы, но диагностика остаётся вторым уровнем защиты: не прошедший decode/capture файл не получает право на публикацию.
- Ошибка metadata прямо сообщает о повреждённом файле или неподдерживаемом кодеке и даёт путь к совместимым форматам.

## Проверка

```bash
pnpm --filter @watch-together/frontend exec vitest run src/features/rooms/file-diagnostics.test.ts src/features/rooms/file-publication.test.ts src/features/rooms/use-room-session-host-controls.test.tsx src/pages/HomePage.test.tsx
pnpm --filter @watch-together/frontend typecheck
pnpm check
```

Автотесты покрывают MP4, M4V, WebM, экспериментальный MKV без MIME preflight, browser rejection для базового формата, недоступный `captureStream()`, metadata failure, отсутствие audio/video track в capture preview и отображение policy/verdict в UI.

Перед внешним обещанием WebM необходим отдельный staging evidence: Chrome/Edge host + guest, реальный MP4 и реальный WebM, video/audio, play/pause/seek и reconnect. До этого policy означает корректную product boundary и runtime diagnostics, а не готовность всех браузеров и кодеков.

## Известные ограничения и следующий шаг

- `captureStream()` ограничивает поддерживаемые браузеры desktop Chrome/Edge.
- `canPlayType()` не извлекает codec profile из контейнера; окончательное решение по конкретному файлу дают browser metadata load и короткий decode/capture preflight, но UI не притворяется полноценным codec inspector.
- Локальный файл остаётся только у host, поэтому его способность декодировать и отправлять поток остаётся частью качества сессии.
- WT-658 расширяет вход до experimental decode/capture для контейнеров, которые уже умеет декодировать host Chromium. Расширение до предсказуемой поддержки HEVC, DTS и любого файла всё ещё требует отдельного desktop helper и licensing review, а не скрытого обхода ограничений web-платформы.
