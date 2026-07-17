# WT-631 — подтверждение восстановления для guest

## Цель

Закрыть feedback-loop при реальной проблеме с просмотром. После кнопки «Видео
зависло» guest должен понимать не только то, что его сообщение отправлено, но
и то, что host начал восстановление и каков его результат.

## Реализовано

- Протокол wt.media-recovery.v1 дополнен сообщением media.recovery.status со
  статусом started, succeeded или failed.
- Host отправляет started тому guest-у, чьё сообщение он подтвердил кнопкой
  «Восстановить». После результата публикации новых LiveKit tracks тому же
  guest-у уходит succeeded или failed.
- Сообщение LiveKit адресное: используется destinationIdentities с identity
  requester-а, поэтому остальные участники комнаты не получают чужой
  recovery-status.
- Guest принимает status только если отправитель совпадает с hostParticipantId
  комнаты. Сообщение от другого guest-а, битый payload или незнакомый тип
  молча игнорируются.
- На media stage guest видит компактный glass-status: «host запускает
  восстановление», «host обновил трансляцию» или понятный нейтральный результат
  ошибки. Status исчезает через 10 секунд либо при disconnect.

## Приватность и безопасность

- В payload есть только schema version, тип, coarse status и timestamp.
  Filename, путь, media bytes, текст чата, токены, room secret и детальное
  сообщение browser-ошибки не передаются.
- Status не запускает автоматических действий на guest-е. Только host решает,
  начинать ли recovery, а guest получает информационное подтверждение.
- Existing 10-second cooldown guest request остаётся; WT-631 не увеличивает
  частоту сообщений и не создаёт backend endpoint.

## Проверки

    pnpm --filter @watch-together/frontend exec vitest run \
      src/features/rooms/media-recovery-signal.test.ts \
      src/features/rooms/use-room-session-host-controls.test.tsx \
      src/pages/HomePage.test.tsx
    pnpm --filter @watch-together/frontend typecheck
    pnpm --filter @watch-together/frontend lint
    pnpm format:check

Тесты подтверждают адресную доставку host → requester, проверку identity
host-а у guest, игнорирование невалидных сообщений и отсутствие регрессии в
room UI.

## Ограничения

- Reliable data message означает попытку надёжной доставки в активной
  LiveKit-сессии, но не гарантирует, что guest увидит UI, если соединение уже
  потеряно. Для этого остаются штатные reconnect/lost состояния.
- Фактическая цепочка Windows ↔ Mac всё ещё должна быть проверена на двух
  устройствах: guest signal → host acknowledgement → новые tracks с
  сохранённой позицией.
