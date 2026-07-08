# Frontend

React-приложение Watch Together, созданное в WT-103.

## Стек

- React 19 и TypeScript.
- Vite.
- React Router.
- TanStack Query.
- Zod для runtime-валидации ответов backend.
- Vitest и React Testing Library.
- ESLint и Prettier.

Zustand и LiveKit Client SDK будут добавлены вместе с реальным product-state и media lifecycle. В foundation-каркасе для них пока нет задачи.

## Локальный запуск

Установить зависимости из корня репозитория:

```bash
pnpm install
```

В первом терминале запустить backend:

```bash
pnpm backend:bootRun
```

Во втором терминале запустить frontend:

```bash
pnpm dev:frontend
```

Frontend будет доступен на `http://127.0.0.1:5173`. Vite проксирует запросы `/api` на `http://127.0.0.1:8080`.

Другой адрес backend для development можно задать через `VITE_BACKEND_PROXY_TARGET`. Для отдельного production API используется `VITE_API_BASE_URL`. Пример находится в `.env.example`.

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

Только frontend:

```bash
pnpm --filter @watch-together/frontend lint
pnpm --filter @watch-together/frontend format:check
pnpm --filter @watch-together/frontend typecheck
pnpm --filter @watch-together/frontend test
pnpm --filter @watch-together/frontend build
```

## Границы WT-103

Реализованы стартовая страница, маршрутизация, Error Boundary, адаптивная оболочка и вызовы `/api/v1/health` и `/api/v1/version`.

Комнаты, аутентификация, LiveKit, media lifecycle, чат и голос находятся вне области WT-103.
