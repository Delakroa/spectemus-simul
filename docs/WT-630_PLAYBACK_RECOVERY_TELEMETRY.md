# WT-630 — telemetry восстановления показа

## Цель

Измерять надёжность уже реализованного recovery-пути, а не полагаться на
единичные ручные впечатления: сколько раз guest попросил помочь, сколько раз
host начал восстановление и сколько попыток завершились публикацией новых
LiveKit-дорожек.

## Реализовано

- Контракт telemetry расширен четырьмя типами: `RECOVERY_REQUESTED`,
  `RECOVERY_STARTED`, `RECOVERY_SUCCEEDED`, `RECOVERY_FAILURE`.
- Guest отправляет `RECOVERY_REQUESTED` только после успешной отправки
  privacy-safe LiveKit signal из WT-629. Повторные клики уже ограничены его
  cooldown и не создают ложных новых событий.
- Host отправляет `RECOVERY_STARTED` при явном нажатии «Восстановить
  трансляцию». Успешная публикация свежих tracks фиксирует
  `RECOVERY_SUCCEEDED`; ошибка `captureStream()`/LiveKit-публикации —
  `RECOVERY_FAILURE` с уже существующим коротким диагностическим detail.
- Backend ведёт только агрегированные Micrometer counters:
  `wt.telemetry.recovery_requested`, `recovery_started`, `recovery_succeeded`,
  `recovery_failure`. Как и остальные telemetry counters, они доступны через
  защищённый actuator/Prometheus surface.

## Приватность и границы

- Новые события не содержат filename, local path, media bytes, chat text,
  LiveKit token или participant identity.
- `roomId`, роль и detail остаются только в privacy-safe log-корреляции и
  никогда не становятся metric tags. Новых tags нет.
- Это агрегированная воронка, не журнал сессий: она не утверждает, что
  конкретный guest request связан с конкретной попыткой host-а.
- Автоматического восстановления или автоматического определения frozen frame
  не добавляется. Решение остаётся за host-ом.

## Как читать результат

- `recovery_requested` против `recovery_started` показывает, не остаются ли
  просьбы guest без действия host-а.
- `recovery_succeeded / (recovery_succeeded + recovery_failure)` — прокси
  надёжности именно ручного recovery. Низкое значение — blocker для развития
  media-фич, а не повод добавлять косметические возможности.
- Эти counters дополняют `first_frame`, `playback_error` и quality telemetry из
  WT-604; они не заменяют обязательный Windows ↔ Mac LAN-прогон.

## Проверки

```bash
pnpm contracts:check
pnpm --filter @watch-together/frontend exec vitest run \
  src/features/telemetry/telemetry.test.ts \
  src/features/rooms/use-room-session-host-controls.test.tsx
pnpm --filter @watch-together/frontend typecheck
pnpm --filter @watch-together/frontend lint
pnpm backend:test
pnpm format:check
```

Unit-тесты фиксируют frontend funnel и backend counters. Полная цепочка
guest signal → host alert → restart → новые tracks по-прежнему требует
реального LAN-прогона на двух устройствах.
