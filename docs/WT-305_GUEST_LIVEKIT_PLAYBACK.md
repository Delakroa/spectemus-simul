# WT-305 Просмотр LiveKit-потока гостем

## Статус

Завершено.

## Цель

Дать guest возможность видеть и слышать remote tracks, которые host публикует в LiveKit в WT-304. WT-305 замыкает первый product media path: host выбирает локальный файл, публикует tracks в LiveKit, guest подписывается на них и воспроизводит поток в product UI.

## Поведение

- Guest после join/restore видит карточку «Просмотр».
- Пока host не опубликовал поток, карточка показывает «Ждём host».
- При `TrackSubscribed` frontend attach-ит remote video track к `HTMLVideoElement`, remote audio track — к `HTMLAudioElement`.
- При получении хотя бы одной media track карточка показывает «Получаем видео» и количество tracks.
- При `TrackUnsubscribed` или disconnect host-а карточка переходит в «Поток потерян».
- При ошибке browser playback карточка показывает «Ошибка» и текст ошибки.
- При leave, close, серверном `room.closed`, LiveKit disconnect и unmount frontend detach-ит remote tracks и сбрасывает playback state.

## Реализация

- `frontend/src/features/rooms/remote-playback.ts` — слой attach/detach remote LiveKit tracks без React-зависимостей.
- `frontend/src/features/rooms/use-room-session.ts` — добавлены `remotePlaybackStatus`, track metadata и `setRemotePlaybackElements()`.
- `frontend/src/pages/HomePage.tsx` — guest-only карточка «Просмотр» с video/audio elements и состояниями remote playback.
- `frontend/src/features/rooms/remote-playback.test.ts` — unit-тесты attach existing tracks и lost после unsubscribe.
- `frontend/src/pages/HomePage.test.tsx` — UI-тест guest playback через mocked LiveKit `trackSubscribed`/`trackUnsubscribed`.

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
- frontend `vitest run` — 34 теста, все прошли;
- `remote-playback.test.ts` проверяет attach/detach remote tracks;
- `HomePage.test.tsx` проверяет guest UI на remote track subscribe/unsubscribe.

## Известные ограничения

- WT-305 не добавляет play/pause/seek sync. Guest видит live WebRTC stream, а не VOD timeline.
- WT-305 не добавляет host playback controls поверх product state.
- Browser autoplay policy может заблокировать audio playback; ошибка отображается в UI, но отдельная кнопка retry будет следующим UX-улучшением.
- Multi-guest quality metrics остаются отдельной проверкой из WT-003/ADR.
