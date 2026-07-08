# WT-103 React frontend

## Статус

Завершено.

## Цель

Создать воспроизводимый frontend foundation для следующих product-задач без преждевременного переноса room и media logic из PoC.

## Реализовано

- React 19, TypeScript 6 и Vite 8.
- React Router с основной страницей и маршрутом 404.
- TanStack Query для server-state.
- Типизированный API-слой с Zod-валидацией.
- Вызовы `GET /api/v1/health` и `GET /api/v1/version`.
- Состояния загрузки, успешного соединения и недоступности backend.
- Глобальный React Error Boundary.
- Адаптивная стартовая страница.
- ESLint, Prettier, TypeScript project references.
- Vitest и React Testing Library.
- Root quality gate для lint, format, typecheck, tests и production build.

## Архитектурные решения

Frontend использует относительные адреса `/api/v1/*`. В development Vite проксирует их на Spring Boot backend. Production-адрес API можно передать через `VITE_API_BASE_URL`.

Ответы backend проверяются на границе приложения через Zod. Некорректный payload считается ошибкой интеграции и не попадает в UI как доверенное состояние.

Zustand и LiveKit Client SDK не добавлены: в WT-103 отсутствуют client product-state и media lifecycle. Эти зависимости должны появиться вместе с реальными сценариями, а не как неиспользуемый каркас.

## Команды

```bash
pnpm dev:frontend
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm check
```

Для development-запуска с backend:

```bash
pnpm backend:bootRun
pnpm dev:frontend
```

## Проверено

- ESLint без предупреждений.
- TypeScript typecheck.
- 4 test files, 7 frontend tests.
- Production build Vite.
- Root `pnpm check`, включая PoC и backend.
- Успешные `health/version` ответы через development proxy.

## Известные ограничения

- Создание и присоединение к комнатам относятся к P2.
- LiveKit lifecycle относится к P3.
- Production reverse proxy появится в WT-104.
- E2E-набор Playwright будет расширен вместе с пользовательскими сценариями; WT-103 покрыт component и integration tests.
- Автоматическая screenshot-проверка не выполнена: встроенный браузер текущей Codex-сессии недоступен. Страница запущена локально для ручной проверки.
