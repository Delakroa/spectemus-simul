# WT-605 Feedback operations

## Статус

Готово. Feedback переведён из “только structured logs” в управляемый beta-process: Redis storage с TTL, operator export, triage поля и runbook просмотра.

## Цель

Закрыть риск из WT-602: beta feedback должен регулярно просматриваться и попадать в список blocker / non-blocker issues. При этом публичная форма WT-601 остаётся простой, а backend по-прежнему не принимает и не хранит media bytes, chat history, room secrets или LiveKit tokens.

## Что изменилось

- `POST /api/v1/feedback` сохраняет sanitized report в Redis и продолжает возвращать `202 Accepted` с `feedbackId`, `correlationId`, `receivedAt`.
- Reports хранятся под TTL `FEEDBACK_RETENTION` (по умолчанию `30d`) и индексируются по `receivedAt`.
- Operator endpoints включаются только при заданном `FEEDBACK_ADMIN_TOKEN`.
- Operator доступ проверяется header-ом `X-Feedback-Admin-Token`; ответы всегда `Cache-Control: no-store`.
- Triage поля: `triageStatus` (`NEW`, `REVIEWING`, `RESOLVED`, `IGNORED`), `severity` (`UNSET`, `LOW`, `MEDIUM`, `HIGH`, `BLOCKER`), `assignee`, `triageNote`, `triagedAt`.
- Public feedback endpoint остаётся под Redis-backed rate limit из WT-606.

## Endpoints

```text
GET   /api/v1/feedback/reports?limit=50
GET   /api/v1/feedback/reports/export?limit=200
GET   /api/v1/feedback/reports/{feedbackId}
PATCH /api/v1/feedback/reports/{feedbackId}
```

Все operator endpoints требуют:

```text
X-Feedback-Admin-Token: <FEEDBACK_ADMIN_TOKEN>
```

Если `FEEDBACK_ADMIN_TOKEN` пустой, endpoints возвращают `403 FEEDBACK_OPERATIONS_DISABLED`.

## Runbook

1. На beta/staging задать `FEEDBACK_ADMIN_TOKEN`, `FEEDBACK_RETENTION=30d`, при необходимости `FEEDBACK_EXPORT_LIMIT=200`.
2. После evidence-сессий открыть список:

   ```bash
   curl -sS \
     -H "X-Feedback-Admin-Token: $FEEDBACK_ADMIN_TOKEN" \
     "$WT_BETA_BASE_URL/api/v1/feedback/reports?limit=50"
   ```

3. Выгрузить полные reports для разбора:

   ```bash
   curl -sS \
     -H "X-Feedback-Admin-Token: $FEEDBACK_ADMIN_TOKEN" \
     "$WT_BETA_BASE_URL/api/v1/feedback/reports/export?limit=200"
   ```

4. По blocker/non-blocker issues обновлять triage:

   ```bash
   curl -sS -X PATCH \
     -H "Content-Type: application/json" \
     -H "X-Feedback-Admin-Token: $FEEDBACK_ADMIN_TOKEN" \
     -d '{"status":"REVIEWING","severity":"HIGH","assignee":"beta-ops","note":"Проверить reconnect path"}' \
     "$WT_BETA_BASE_URL/api/v1/feedback/reports/<feedbackId>"
   ```

5. В evidence report переносить `feedbackId`, `correlationId`, итог triage и ссылку на issue/PR.

## Privacy boundary

Хранится только то, что уже разрешено WT-601: outcome, reason, короткий message, room/role/correlation context и privacy-safe browser/network metadata. Backend не хранит media content, local file paths, chat history, LiveKit tokens, host secrets или browser cookies.

## Проверка

```bash
./gradlew :backend:test
```

Покрыто:

- MVC contract для submit/list/export/triage и token-gate;
- сервисная запись в storage, sanitize, preview и triage update;
- OpenAPI контракт operator endpoints.

## Ограничения

- Это beta operations API, не полноценная admin panel.
- Storage использует Redis TTL, поэтому reports старше retention удаляются автоматически.
- Operator endpoints защищены shared token-ом; перед расширением beta до внешних операторов нужен нормальный auth/RBAC.
