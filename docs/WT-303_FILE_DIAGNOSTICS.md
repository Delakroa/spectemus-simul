# WT-303 File diagnostics

## Статус

Завершено.

## Цель

Дать host возможность выбрать локальный видеофайл и убедиться, что браузер сможет его воспроизвести и захватить через `captureStream()`, прежде чем публикация начнётся в WT-304. Байты файла не покидают браузер.

## Поведение

- В room dashboard host видит карточку «Видеофайл» с кнопкой «Выбрать файл».
- После выбора файла запускается диагностика: format check → captureStream check → metadata load → video track check.
- При успехе карточка показывает имя файла, длительность и наличие звука. Статус «Готов» виден рядом с заголовком.
- При ошибке показывается текст ошибки на русском языке.
- Гость не видит карточку выбора файла.
- Объектный URL отзывается при leave, close и unmount.

## Диагностические коды ошибок

| Код | Причина |
|---|---|
| `UNSUPPORTED_FORMAT` | `canPlayType()` вернул пустую строку |
| `CAPTURE_STREAM_UNAVAILABLE` | `captureStream()` недоступен в браузере |
| `NO_VIDEO_TRACK` | `videoWidth === 0` после загрузки metadata |
| `METADATA_LOAD_FAILED` | `onerror` до `onloadedmetadata` |

## Реализация

- `frontend/src/features/rooms/file-diagnostics.ts` — чистая async функция `diagnoseFile(file)`, без зависимостей на React.
- `frontend/src/features/rooms/use-room-session.ts` — добавлены `fileStatus`, `fileResult`, `fileError` в state; callback `selectFile`; cleanup в leave/close/unmount.
- `frontend/src/pages/HomePage.tsx` — карточка file picker видна только HOST при активной не-CLOSED комнате.

## Проверка

```bash
pnpm --filter @watch-together/frontend typecheck
pnpm --filter @watch-together/frontend test
```

Локально в этой задаче проверено:

- `tsc -b --noEmit` прошёл без ошибок.
- `vitest run` — 27 тестов, все прошли; включая 6 тестов `file-diagnostics.test.ts` и 4 новых теста `HomePage.test.tsx`.
- Карточка «Видеофайл» рендерится только для HOST.
- Guest не видит file picker.

## Известные ограничения

- `hasAudio` всегда `true`: браузерное API не позволяет надёжно определить наличие аудиодорожки из metadata без декодирования.
- WT-303 не публикует файл в LiveKit — это задача WT-304.
- `captureStream()` поддерживается только в Chrome и Edge; Safari и Firefox вызовут `CAPTURE_STREAM_UNAVAILABLE`.
