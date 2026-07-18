# WT-632 — корреляция recovery request и status

## Цель

Не позволить запоздавшему статусу предыдущего восстановления перезаписать
состояние новой попытки guest-а.

## Реализовано

- Каждый новый `media.recovery.request` получает случайный UUID `requestId`.
- Host сохраняет `requestId` из принятого запроса и возвращает его в адресных
  статусах `started`, `succeeded` и `failed`.
- Guest принимает статус от ожидаемого host-а только для своей последней
  попытки. Status с другим `requestId` молча игнорируется.
- `requestId` остаётся опциональным в schema version 1. Это сохраняет чтение
  сообщений WT-629–WT-631 при поэтапном обновлении клиентов; status старого
  клиента без ID по-прежнему принимается.

## Приватность и безопасность

- `requestId` — случайный технический идентификатор одной попытки. Он не
  содержит room ID, participant identity, имя файла, путь или media metadata.
- Проверка identity host-а и адресная доставка `destinationIdentities` из
  WT-631 сохранены.
- Cooldown 10 секунд и отсутствие backend persistence не изменились.

## Проверки

    pnpm --filter @watch-together/frontend exec vitest run \
      src/features/rooms/media-recovery-signal.test.ts \
      src/features/rooms/use-room-session-host-controls.test.tsx \
      src/pages/HomePage.test.tsx
    pnpm check

Тесты проверяют передачу UUID request → host → guest и игнорирование
запоздавшего status от другой попытки.

## Ограничения

- При совместной работе с клиентом WT-631 status без `requestId` принимается
  ради совместимости и не защищён от переупорядочивания. Полная корреляция
  действует после обновления обеих сторон до WT-632.
- Ручная Windows ↔ Mac проверка recovery-loop остаётся частью следующего
  двухустройственного прогона.
