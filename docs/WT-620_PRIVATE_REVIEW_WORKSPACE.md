# WT-620 — Private Review workspace IA and visual redesign

## Статус

Завершено.

## Цель

Перевести комнату из набора равноправных технических карточек в приватное рабочее пространство для совместного просмотра и review. Главный объект страницы — медиа-сцена; чат и участники помогают сеансу, но не конкурируют с видео.

## Реализация

- Entry page и активная комната разделены: до создания комнаты остаётся короткое объяснение и create/join flow, а активная комната получает компактный заголовок с connection status.
- В активной комнате media stage занимает левую основную колонку. Host видит file dock перед публикацией, а guest — ожидание или remote playback на той же сцене.
- Чат и participants перенесены в правую rail. В rail явно обозначены будущие notes, но функциональные заметки в этот тикет не добавлялись.
- Quality, room state и event log стали нативными сворачиваемыми `details`; техническая информация не мешает просмотру, но остаётся доступной без потери данных.
- File dock поддерживает drag-and-drop и обычный keyboard-accessible file picker. Drop проходит через ту же диагностику WT-619: никаких обходов browser-native policy или публикации непроверенного файла.
- Для room workspace добавлена тёмная desktop-first visual system: контрастная сцена, компактные control surfaces, focus states, narrow-layout перестройка в одну колонку и сохранение `prefers-reduced-motion` поведения.

## Не входит в тикет

- time-coded notes и comments;
- mobile video support или обещание Safari/Firefox compatibility;
- URL/streaming-source flow, торрент-интеграция, каталоги, DRM и загрузка видео на backend;
- QR/Telegram invite share — это WT-617;
- реакции и stage callouts — это WT-624 после evidence/WTP decision.

## Проверка

```bash
pnpm --filter @watch-together/frontend exec vitest run src/pages/HomePage.test.tsx
pnpm --filter @watch-together/frontend lint
pnpm --filter @watch-together/frontend typecheck
pnpm check
pnpm test:e2e
```

`HomePage` test подтверждает active workspace markers, правую rail, closed diagnostics и drag-and-drop выбора файла с прежним runtime preflight. Визуальный review выполняется в desktop и narrow viewport перед merge.

## Следующий шаг

WT-617 добавит безопасный share sheet: copy invite, QR, Telegram-share и Web Share fallback. В QR и share payload разрешена только публичная ссылка комнаты — без host/operator/LiveKit token, имени фильма или telemetry.
