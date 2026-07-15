# WT-617 — Secure share sheet and QR invitation

## Статус

Завершено.

## Цель

Снять friction приглашения в private review room, не расширяя beta-модель доступа и не раскрывая operational или media-plane данные.

## Реализация

- В заголовке активной комнаты появился share sheet: Copy, QR, Telegram и native Web Share с copy fallback.
- Все share-каналы используют один canonical URL вида `origin/rooms/{roomId}`. Helper принимает только публичный room route и отбрасывает query, hash и любые credentials.
- QR создаётся локально в браузере, без внешнего QR-сервиса. В нём находится только canonical URL комнаты.
- Telegram получает только canonical URL и нейтральный текст приглашения; название файла, `hostSecret`, operator/LiveKit token и telemetry исключены из payload по конструкции.
- Открытие invite route на телефоне показывает desktop handoff: beta честно предлагает отправить ссылку себе и открыть её в Chrome/Edge на компьютере, не обещая mobile video playback.
- Закрытая или истёкшая комната сохраняет существующее server-side поведение: публичный route больше не даёт войти в сессию. Индивидуальные отзывные invite-токены остаются задачей будущего accounts/roles слоя.

## Не входит в тикет

- accounts, contacts, bots и индивидуальные revoke-токены;
- mobile video playback;
- отправка имени фильма, технических метрик или token в какой-либо share surface;
- URL/streaming-source flow, торрент-интеграция и загрузка файла на backend.

## Проверка

```bash
pnpm --filter @watch-together/frontend exec vitest run \
  src/features/rooms/share-invite.test.ts \
  src/pages/HomePage.test.tsx
pnpm check
pnpm test:e2e
```

Unit-тесты проверяют canonicalization, отсечение query/hash, Telegram payload и mobile handoff URL. HomePage coverage проверяет share sheet, локальный QR и доступные share actions.

## Следующий шаг

WT-610 — операционный TLS-staging evidence run: реальные desktop host+1/host+3 сессии, нормальная и TURN/UDP-blocked сеть, feedback triage и QoS/cost evidence. Это не заменяется локальными unit/E2E тестами.
