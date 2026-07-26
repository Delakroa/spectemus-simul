# WT-634 — timeout результата восстановления

## Цель

Не оставлять guest-а в неопределённости, если host подтвердил начало recovery,
но итоговый status `succeeded` или `failed` не дошёл через LiveKit.

## Реализовано

- После `media.recovery.status: started` guest ждёт итоговый status 30 секунд.
- Если результат не пришёл, UI переходит в `timed_out` и показывает: «Не
  получили результат восстановления. Можно отправить сигнал ещё раз».
- В `timed_out` recovery-кнопка доступна. Повтор использует новый `requestId`,
  поэтому запоздавший результат старой попытки будет отброшен по WT-632.
- `succeeded`, `failed` и `timed_out` остаются эфемерными и скрываются через
  10 секунд. Disconnect очищает их сразу.

## Приватность и безопасность

- Timeout рассчитывается только в памяти guest-браузера.
- Новых payload, backend endpoint, persistence или telemetry dimensions нет.
- Timeout не утверждает, что recovery фактически завершился ошибкой: он
  означает лишь отсутствие итогового status в активной LiveKit-сессии.

## Проверки

    pnpm --filter @spectemus-simul/frontend exec vitest run \
      src/features/rooms/use-room-session-host-controls.test.tsx \
      src/pages/HomePage.test.tsx
    pnpm check

Тест имитирует адресный `started`, запускает 30-секундный result timer и
проверяет переход в `timed_out`.

## Ограничения

- Таймаут не проверяет фактическое состояние media tracks. Guest может вручную
  повторить сигнал, если видео всё ещё не восстановилось.
- Ручная Windows ↔ Mac проверка полного recovery-loop остаётся отдельным
  двухустройственным прогоном.
