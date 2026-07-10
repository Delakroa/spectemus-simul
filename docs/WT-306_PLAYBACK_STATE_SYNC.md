# WT-306 Синхронизация playback state

## Статус

Завершено.

## Цель

Перенести подтверждённый в WT-004 `playback-state` подход в product frontend: host остаётся авторитетным источником состояния просмотра, а guest получает состояние через LiveKit data channel и применяет его к remote playback из WT-305.

WT-306 не меняет backend room lifecycle и не загружает файл на сервер. Байты фильма по-прежнему остаются в браузере host-а.

## Поведение

- После успешной публикации файла host запускает `playback-state` publisher поверх локального `HTMLVideoElement`.
- Host отправляет reliable data messages в topic `wt.playback-state.v1`.
- Сообщение содержит `revision`, `event`, `status`, `currentTime`, `duration`, `sentAt` и `fileName`.
- Publisher отправляет состояние при `publish`, `metadata`, `play`, `pause`, `seeked`, `ended`, `stop` и раз в секунду как heartbeat.
- Guest слушает только topic `wt.playback-state.v1`.
- Guest принимает только сообщения от LiveKit participant identity host-а.
- Guest применяет только монотонно новые `revision`.
- При `playing` guest вызывает `play()` на remote video element.
- При `paused`, `ended` или `idle` guest вызывает `pause()` на remote video element.
- Карточка «Просмотр» показывает строку `Host playback`: состояние, время, revision и имя файла.
- При некорректном payload guest показывает ошибку playback sync, но не ломает media playback.
- Cleanup выполняется при stop publication, выборе нового файла, leave, close, `room.closed`, LiveKit disconnect и unmount.

## Реализация

- `frontend/src/features/rooms/playback-state.ts` — encoder/decoder payload, host publisher и guest receiver без React-зависимостей.
- `frontend/src/features/rooms/use-room-session.ts` — lifecycle publisher/receiver и state для `playbackSync*`.
- `frontend/src/pages/HomePage.tsx` — отображение `Host playback` в guest карточке «Просмотр».
- `frontend/src/features/rooms/playback-state.test.ts` — unit-тесты payload, publisher и receiver.
- `frontend/src/pages/HomePage.test.tsx` — UI-тест guest playback + data-channel state.

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
- frontend `vitest run` прошёл без ошибок;
- `playback-state.test.ts` проверяет reliable publish, topic, stop message и применение fresh revision;
- `HomePage.test.tsx` проверяет получение `wt.playback-state.v1` и применение play/pause в guest UI.

## Известные ограничения

- Guest получает live WebRTC stream, а не исходный VOD-файл. Поэтому `seek` отображается как новое состояние host-а, но guest не делает точный `currentTime = host.currentTime`.
- WT-306 не добавляет отдельные host playback controls в UI. Host управляет скрытым source video element через browser playback выбранного файла.
- При browser autoplay restriction `play()` может быть отклонён; ошибка отображается в UI.
- Авторитетное backend-owned media state остаётся отдельным будущим шагом, если понадобится persistence, audit или восстановление состояния без host heartbeat.
