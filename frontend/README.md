# Frontend

React-приложение Watch Together, созданное в WT-103.

## Стек

- React 19 и TypeScript.
- Vite.
- React Router.
- TanStack Query.
- Zod для runtime-валидации ответов бэкенда.
- LiveKit Client SDK для product media-plane connection.
- Vitest и React Testing Library.
- ESLint и Prettier.

Zustand будет добавлен вместе с реальными сценариями product-state, если состояние media controls станет достаточно сложным.

## Локальный запуск

Установить зависимости из корня репозитория:

```bash
pnpm install
```

В первом терминале запустить бэкенд:

```bash
pnpm backend:bootRun
```

Во втором терминале запустить фронтенд:

```bash
pnpm dev:frontend
```

Фронтенд будет доступен на `http://127.0.0.1:5173`. Vite проксирует REST и WebSocket запросы `/api` на `http://127.0.0.1:8080`.

Другой адрес бэкенда для локальной разработки можно задать через `VITE_BACKEND_PROXY_TARGET`. Для отдельного production API используется `VITE_API_BASE_URL`. Пример находится в `.env.example`.

## Проверки

Из корня репозитория:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm check
```

Только фронтенд:

```bash
pnpm --filter @watch-together/frontend lint
pnpm --filter @watch-together/frontend format:check
pnpm --filter @watch-together/frontend typecheck
pnpm --filter @watch-together/frontend test
pnpm --filter @watch-together/frontend build
```

## Текущий product UI

WT-103 реализовал стартовую страницу, маршрутизацию, Error Boundary, адаптивную оболочку и вызовы `/api/v1/health` и `/api/v1/version`.

WT-208 добавил первый room lifecycle UI:

- создание комнаты через `POST /api/v1/rooms`;
- вход гостя через `/rooms/{roomId}` или форму с room ID;
- WebSocket `/api/v1/rooms/{roomId}/events`;
- runtime validation REST/WebSocket payload через Zod;
- применение `room.snapshot`, `participant.joined`, `participant.left`, `participant.online`, `participant.offline` и `room.closed`;
- heartbeat `participant.heartbeat` для открытого WebSocket;
- команды close для host и leave для guest.

WT-209 добавил восстановление room session:

- `GET /api/v1/rooms/{roomId}` возвращает текущего participant и room snapshot по `wt_session`;
- открытие `/rooms/{roomId}` автоматически восстанавливает комнату без повторного join, если cookie ещё действительна;
- после restore frontend снова подключает WebSocket и продолжает heartbeat;
- host secret сохраняется только в `sessionStorage` текущего browser session, чтобы host мог закрыть комнату после refresh.

WT-301 добавляет typed API client для `POST /api/v1/rooms/{roomId}/livekit-token`.

WT-302 добавляет LiveKit client connection:

- после create/join/restore frontend запрашивает LiveKit token;
- подключается к LiveKit room через `livekit-client`;
- показывает отдельный статус LiveKit;
- disconnect выполняется при leave, close, `room.closed` и unmount.

WT-303 добавляет диагностику локального видеофайла:

- host видит карточку «Видеофайл» в room dashboard после создания комнаты;
- `diagnoseFile(file)` проверяет формат, `captureStream` и metadata до передачи файла в LiveKit;
- объектный URL управляется в `use-room-session` и отзывается при leave, close, `room.closed` и unmount;
- guest не видит file picker.

WT-304 добавляет публикацию выбранного файла host-а в LiveKit:

- `publishFile()` создаёт локальный `HTMLVideoElement`, получает tracks через `captureStream()` и публикует их в LiveKit;
- `stopFilePublication()` снимает публикацию и останавливает captured tracks;
- UI показывает состояния `Публикация`, `Live` и ошибку публикации;
- cleanup выполняется при выборе нового файла, leave, close, `room.closed`, LiveKit disconnect и unmount.

WT-305 добавляет guest playback:

- guest видит карточку «Просмотр» после входа в комнату;
- remote video track attach-ится к `HTMLVideoElement`, remote audio track — к `HTMLAudioElement`;
- UI показывает состояния `Ждём host`, `Получаем видео`, `Поток потерян` и `Ошибка`;
- cleanup выполняется при leave, close, `room.closed`, LiveKit disconnect и unmount.

WT-306 добавляет playback state sync:

- host публикует reliable data messages в LiveKit topic `wt.playback-state.v1`;
- guest принимает только host messages с монотонной `revision`;
- `playing` вызывает `play()` на guest remote video, `paused`, `ended` и `idle` вызывают `pause()`;
- guest UI показывает `Host playback`, время, revision и имя файла.

Точная VOD-синхронизация seek, чат и голос остаются вне текущего frontend product UI.

REST, WebSocket и error contracts находятся в [`../contracts`](../contracts/README.md). Все внешние payload должны проходить runtime validation до попадания в состояние приложения.
