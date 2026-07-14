# WT-303 Диагностика видеофайла

## Статус

Завершено.

## Цель

Дать host возможность выбрать локальный видеофайл и убедиться, что браузер сможет его воспроизвести и захватить через `captureStream()`, прежде чем публикация начнётся в WT-304. Байты файла не покидают браузер.

## Поведение

- В room dashboard host видит карточку «Видеофайл» с кнопкой «Выбрать файл».
- После выбора файла запускается диагностика: проверка формата → проверка `captureStream()` → загрузка metadata → проверка видеодорожки.
- При успехе карточка показывает имя файла, длительность и наличие звука. Статус «Готов» виден рядом с заголовком.
- При ошибке показывается текст ошибки на русском языке.
- Гость не видит карточку выбора файла.
- Объектный URL отзывается при leave, close, серверном `room.closed` и unmount.

## Диагностические коды ошибок

| Код                          | Причина                                    |
| ---------------------------- | ------------------------------------------ |
| `UNSUPPORTED_FORMAT`         | `canPlayType()` вернул пустую строку       |
| `CAPTURE_STREAM_UNAVAILABLE` | `captureStream()` недоступен в браузере    |
| `CAPTURE_PREVIEW_FAILED`     | Decode/capture preview не дал видеодорожку |
| `NO_VIDEO_TRACK`             | `videoWidth === 0` после загрузки metadata |
| `METADATA_LOAD_FAILED`       | `onerror` до `onloadedmetadata`            |

## Реализация

- `frontend/src/features/rooms/file-diagnostics.ts` — чистая async функция `diagnoseFile(file)`, без зависимостей на React.
- `frontend/src/features/rooms/use-room-session.ts` — добавлены `fileStatus`, `fileResult`, `fileError` в state; callback `selectFile`; cleanup в leave/close/room.closed/unmount.
- `frontend/src/pages/HomePage.tsx` — карточка file picker видна только HOST при активной не-CLOSED комнате.

## Проверка

```bash
pnpm --filter @watch-together/frontend typecheck
pnpm --filter @watch-together/frontend test
```

Локально в этой задаче проверено:

- `tsc -b --pretty false` прошёл без ошибок.
- `vitest run` — 28 тестов, все прошли; включая 6 тестов `file-diagnostics.test.ts`, 4 новых теста `HomePage.test.tsx` и тест защиты от устаревшей диагностики в `use-room-session.test.tsx`.
- Карточка «Видеофайл» рендерится только для HOST.
- Guest не видит file picker.

## Известные ограничения

- В исторической реализации WT-303 `hasAudio` всегда был `true`: metadata сам по себе не даёт надёжный ответ. WT-619 заменил это на проверку audio track из короткого `captureStream()` preview.
- WT-303 не публикует файл в LiveKit — это задача WT-304.
- `captureStream()` поддерживается только в Chrome и Edge; Safari и Firefox вызовут `CAPTURE_STREAM_UNAVAILABLE`.

## Продолжение

WT-619 формализует текущую compatibility policy для MP4/M4V и WebM, точный `accept` file picker и диагностические сообщения. Исторический baseline этого тикета остаётся прежним: первая доказанная связка была MP4 H.264/AAC на desktop Chromium.
