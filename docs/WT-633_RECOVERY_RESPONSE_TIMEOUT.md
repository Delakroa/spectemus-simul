# WT-633 — ожидание ответа host на recovery request

## Цель

Дать guest-у понятный результат, если host не подтвердил сигнал о зависшем
видео, и разрешить повторную отправку без неясного исчезновения статуса.

## Реализовано

- После отправки guest ждёт ответ host-а 10 секунд.
- Если за это время не пришёл `started`, `succeeded` или `failed`, состояние
  переходит в `unanswered` с текстом «Host пока не ответил. Можно отправить
  сигнал ещё раз».
- В состоянии `unanswered` кнопка recovery снова доступна. Новый запрос
  проходит через существующий cooldown и получает новый `requestId` WT-632.
- Любой валидный status текущего запроса завершает ожидание ответа; дальше UI
  показывает результат host-а по правилам WT-631.
- Disconnect очищает `unanswered` вместе с остальными эфемерными recovery
  состояниями.

## Проверки

    pnpm --filter @watch-together/frontend exec vitest run \
      src/features/rooms/use-room-session-host-controls.test.tsx \
      src/pages/HomePage.test.tsx
    pnpm check

## Ограничения

- Timeout означает только отсутствие status в активной LiveKit-сессии. Он не
  утверждает, что host offline или намеренно проигнорировал запрос.
- История unanswered-событий не сохраняется на backend и не раскрывается
  другим участникам.
