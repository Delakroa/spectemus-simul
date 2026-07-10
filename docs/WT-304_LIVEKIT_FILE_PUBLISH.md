# WT-304 Публикация локального файла в LiveKit

## Статус

Завершено.

## Цель

Дать host возможность опубликовать выбранный локальный видеофайл в LiveKit room после диагностики WT-303. Байты файла остаются в браузере host-а: frontend создаёт локальный `HTMLVideoElement`, получает `MediaStream` через `captureStream()` и публикует tracks в LiveKit.

## Поведение

- Host выбирает файл через карточку «Видеофайл».
- После успешной диагностики host может нажать «Опубликовать».
- Frontend создаёт управляемый `HTMLVideoElement`, ждёт metadata, вызывает `captureStream()` и запускает локальное muted playback.
- Video track публикуется в LiveKit как `movie-video`.
- Audio track публикуется как `movie-audio`, если он есть в captured stream.
- Карточка показывает состояния публикации: `Не опубликовано`, `Публикация`, `Live`, `Ошибка`.
- Host может остановить публикацию кнопкой «Остановить».
- При выборе нового файла, leave, close, серверном `room.closed`, LiveKit disconnect или unmount публикация очищается: tracks unpublish/stop, локальный video element сбрасывается, object URL отзывается.
- Guest UI пока не воспроизводит remote tracks.

## Реализация

- `frontend/src/features/rooms/file-publication.ts` — слой media publish/stop без React-зависимостей.
- `frontend/src/features/rooms/use-room-session.ts` — добавлены `filePublicationStatus`, `filePublicationError`, `filePublicationTrackCount`, callbacks `publishFile()` и `stopFilePublication()`.
- `frontend/src/pages/HomePage.tsx` — в карточке «Видеофайл» добавлены кнопки publish/stop и статус публикации.
- `frontend/src/features/rooms/file-publication.test.ts` — unit-тесты publish/stop и отсутствующей видеодорожки.
- `frontend/src/pages/HomePage.test.tsx` — UI-тест host publish/stop через mocked `livekit-client`.

## Проверка

```bash
pnpm --filter @watch-together/frontend lint
pnpm --filter @watch-together/frontend typecheck
pnpm --filter @watch-together/frontend test
pnpm --filter @watch-together/frontend build
```

Локально в этой задаче проверено:

- frontend `eslint` прошёл без ошибок;
- frontend `tsc -b --pretty false` прошёл без ошибок;
- frontend `vitest run` — 31 тест, все прошли;
- `file-publication.test.ts` проверяет публикацию video/audio tracks и cleanup;
- `HomePage.test.tsx` проверяет publish/stop из UI host-а.

## Известные ограничения

- WT-304 не добавляет guest remote playback. Это следующий отдельный шаг.
- WT-304 не добавляет playback controls и синхронизацию play/pause/seek.
- При ошибке публикации audio текущая реализация откатывает публикацию целиком, чтобы не оставлять частично опубликованное состояние.
- `captureStream()` остаётся браузерной границей Chrome/Edge, как описано в WT-303.
