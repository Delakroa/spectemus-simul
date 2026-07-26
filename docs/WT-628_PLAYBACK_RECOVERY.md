# WT-628 — восстановление показа без потери позиции

## Цель

Убрать ручной ритуал «остановить публикацию, опубликовать файл заново и
вернуться к нужному моменту», если host хочет восстановить media stream после
сбоя декодера, `captureStream()` или LiveKit-дорожек.

## Реализовано

- В нижнем glass-слое media stage у host появилась компактная кнопка
  «Восстановить трансляцию». Она создаёт новые локальные media tracks и
  перепубликует тот же выбранный файл в LiveKit.
- Перед restart сохраняются текущая позиция и состояние паузы. Новый source
  video восстанавливает время после metadata, затем заново создаёт
  `captureStream()` и публикует tracks. Пауза не превращается в неожиданное
  воспроизведение.
- Во время операции stage честно показывает состояние «Восстанавливаем показ»;
  кнопка не позволяет запустить второй параллельный restart.
- Автоматический republish после LiveKit reconnect использует тот же checkpoint:
  reconnect больше не обязан возвращать фильм к началу.
- Ожидание browser `seeked` ограничено 1,5 секунды. Если конкретный browser не
  пришлёт событие, recovery не остаётся навсегда заблокированным.

## Проверки

```bash
pnpm --filter @spectemus-simul/frontend exec vitest run \
  src/features/rooms/file-publication.test.ts \
  src/features/rooms/use-room-session-host-controls.test.tsx \
  src/pages/HomePage.test.tsx
pnpm --filter @spectemus-simul/frontend typecheck
pnpm --filter @spectemus-simul/frontend lint
pnpm format:check
```

Тесты покрывают сохранение позиции/паузы на новом source video, ручной restart
и reconnect host-а. Визуально проверяется, что restart остаётся host-only и не
попадает в controls гостя.

## Ограничения

- Приложение не может надёжно узнать, что у гостя «застыл именно кадр»: в
  текущем browser-to-LiveKit path нет такого end-to-end сигнала. Поэтому
  recovery — явное и обратимое действие host-а, а не ложное автоматическое
  срабатывание.
- Restart заменяет LiveKit tracks. Гостю может потребоваться короткое ожидание
  подписки на новые дорожки; это нормальное поведение и не передаёт файл на
  backend.
- Следующий реальный LAN-прогон должен проверить частую перемотку и restart на
  Windows host → Mac guest и Mac host → Windows guest до перехода к новым
  возможностям media pipeline.
