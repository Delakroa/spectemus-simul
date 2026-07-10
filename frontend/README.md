# Frontend

React-приложение Watch Together, созданное в WT-103.

## Стек

- React 19 и TypeScript.
- Vite.
- React Router.
- TanStack Query.
- Zod для runtime-валидации ответов бэкенда.
- Vitest и React Testing Library.
- ESLint и Prettier.

Zustand и LiveKit Client SDK будут добавлены вместе с реальными сценариями product-state и media lifecycle. В foundation-каркасе для них пока нет задачи.

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

LiveKit, media lifecycle, чат и голос остаются вне текущего frontend product UI.

REST, WebSocket и error contracts находятся в [`../contracts`](../contracts/README.md). Все внешние payload должны проходить runtime validation до попадания в состояние приложения.
