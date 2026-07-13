# WT-609 Operator dashboard

## Статус

Готово. В product frontend добавлена операторская панель для просмотра beta feedback reports, фильтрации и triage без curl-команд.

## Цель

Сделать одиночное beta-тестирование менее слепым: после host/guest прогонов оператор должен быстро увидеть новые reports, блокеры, комнаты, причины проблем и обновить triage статус прямо из локального/стейджинг UI.

## Что изменилось

- Добавлен route `/operator`.
- Панель использует существующие WT-605 endpoints:
  - `GET /api/v1/feedback/reports?limit=100`;
  - `GET /api/v1/feedback/reports/{feedbackId}`;
  - `PATCH /api/v1/feedback/reports/{feedbackId}`;
  - `GET /api/v1/feedback/reports/export?limit=200`.
- Operator token вводится в UI и передаётся как `X-Feedback-Admin-Token`.
- Token сохраняется только в browser `localStorage` на машине оператора.
- Добавлены summary-счётчики: total/open/blockers/issues/worked/rooms.
- Добавлены фильтры по triage status и outcome.
- Добавлены действия triage: `REVIEWING`, `BLOCKER`, `RESOLVED`, `IGNORED`.
- Export скачивает JSON с полными reports для evidence/runbook разбора.

## Privacy boundary

Панель не читает media bytes, local file paths, room secrets, LiveKit tokens, cookies или chat history. Она отображает только sanitized feedback reports и privacy-safe metadata, уже разрешённые WT-601/WT-605.

## Как пользоваться

1. На backend/staging должен быть задан `FEEDBACK_ADMIN_TOKEN`.
2. Открыть `/operator`.
3. Ввести тот же token.
4. Использовать фильтры `Открытые`, `Проблемы`, `Блокеры`.
5. Открывать детали report и переносить важные `feedbackId`/`correlationId` в beta evidence.
6. Помечать triage после разбора.

## Проверка

```bash
pnpm --filter @watch-together/frontend test --OperatorDashboardPage operator-api App
pnpm --filter @watch-together/frontend typecheck
```

Покрыто:

- operator API client: list и triage headers/body;
- `/operator` route;
- UI flow: token -> reports -> details -> blocker triage.

## Ограничения

- Это beta operator tool, не полноценная admin console.
- Auth остаётся shared-token моделью WT-605; для внешних операторов нужен отдельный auth/RBAC.
- Reports зависят от Redis TTL и исчезают после `FEEDBACK_RETENTION`.
- Метрики WT-506/WT-604 пока не встроены в эту панель; WT-609 закрывает именно feedback operations UI.
