# WT-601 — Feedback

## Статус

Сделано.

## Цель

Добавить быстрый канал обратной связи для closed beta: участник может отметить итог сессии, причину проблемы или успеха, оставить короткий комментарий и приложить безопасный технический контекст. Каждый отзыв получает receipt с `feedbackId` и `correlationId`, чтобы его можно было сопоставить с логами backend.

## Реализовано

- REST endpoint `POST /api/v1/feedback`.
- Contract-first описание в `contracts/openapi.yaml`.
- Backend validation для `outcome`, `reason`, `roomId`, `relatedCorrelationId`, длины комментария и metadata bounds.
- Структурированный backend log entry с `feedbackId`, `correlationId`, `outcome`, `reason`, optional room/role context и sanitized message.
- Frontend API client `submitFeedback`.
- Форма в product UI с outcome/reason, комментарием, opt-in technical metadata и статусом отправки.
- `infra:check` и `beta:smoke` проверяют, что endpoint принимает feedback и возвращает валидный receipt.

## Приватность

Endpoint не принимает и не логирует:

- media bytes или локальный файл;
- `hostSecret`, session cookie, LiveKit token;
- историю чата;
- participant id и display name.

Optional metadata ограничена состояниями клиента: browser language/platform, viewport, network hints, room/livekit/quality status и participant count.

## Проверки

- `FeedbackControllerTest` покрывает `202 Accepted`, `Cache-Control: no-store`, correlation header и `422 VALIDATION_FAILED`.
- `feedback-api.test.ts` покрывает typed frontend client и problem details.
- `HomePage.test.tsx` покрывает отправку beta feedback из UI.
- `contracts:check` валидирует OpenAPI после добавления `FeedbackRequest` / `FeedbackResponse`.

## Ограничения

- WT-601 не добавляет persisted feedback storage или admin UI.
- На beta-этапе источник правды для отзывов — backend logs и correlation/feedback ids.
- Rate limit для feedback endpoint пока не выделен отдельно; при росте beta-трафика это следующий кандидат на hardening.
