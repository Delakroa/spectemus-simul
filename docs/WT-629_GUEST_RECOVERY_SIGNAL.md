# WT-629 — guest recovery signal

## Цель

Сделать восстановление показа управляемым в момент, когда проблему видит guest:
не заставлять его искать host-а в чате и не заставлять host-а угадывать, почему
просмотр остановился.

## Реализовано

- Guest получает компактную кнопку «Видео зависло» в нижнем glass-слое media
  stage. Она доступна только после подключения к LiveKit.
- Нажатие отправляет reliable data message в отдельном topic
  `wt.media-recovery.v1`. В payload есть только schema version, тип действия и
  время запроса — без имени фильма, local path, токенов или media bytes.
- Host валидирует payload и видит поверх media stage заметный alert «Гость
  сообщает: видео зависло» с одной явной кнопкой «Восстановить».
- Recovery не выполняется автоматически: только host решает, перезапускать ли
  LiveKit tracks через WT-628. Это защищает просмотр от случайного или
  недоверенного data message.
- На обеих сторонах есть 10-секундный cooldown: guest не засоряет канал
  повторными нажатиями, а host не получает повторные alerts от одного источника.
- При disconnect/reconnect контроллер и transient alert очищаются вместе с
  LiveKit lifecycle.

## Проверки

```bash
pnpm --filter @watch-together/frontend exec vitest run \
  src/features/rooms/media-recovery-signal.test.ts \
  src/features/rooms/use-room-session-host-controls.test.tsx \
  src/pages/HomePage.test.tsx
pnpm --filter @watch-together/frontend typecheck
pnpm --filter @watch-together/frontend lint
pnpm format:check
```

Тесты проверяют encode/decode, отдельный reliable topic, дедупликацию на host,
отклонение malformed payload и host/guest visibility controls.

## Ограничения

- Это ручной сигнал человека, а не детектор замёрзшего кадра. Browser и
  `captureStream()` не дают надёжного end-to-end критерия frozen frame для
  автоматического recovery.
- Data message требует активного LiveKit connection. Если соединение потеряно,
  интерфейс комнаты показывает штатное reconnect/lost состояние.
- Следующий LAN-прогон должен проверить цепочку полностью: guest нажимает
  «Видео зависло» → host видит alert → host восстанавливает stream, а guest
  получает новые tracks с сохранённой позицией.
