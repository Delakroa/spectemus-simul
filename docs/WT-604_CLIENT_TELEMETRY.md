# WT-604 Client telemetry

## Статус

Сделано (repo-side).

## Цель

Дать beta возможность считать ключевую продуктовую метрику **Successful Watch Session Rate**, которую WT-602 product review отметил как неизмеримую. Для этого добавлен privacy-safe telemetry endpoint и frontend-события о ключевых точках watch-сессии (first frame, publish/playback ошибки, quality). Метрики ложатся на уже существующую WT-506 Micrometer/prometheus-основу.

Telemetry не персистит историю и не хранит идентифицирующие данные: backend инкрементирует агрегированные counters и пишет privacy-safe log-строку, но не сохраняет per-session записи. WT-605 закрывает managed storage/export для feedback; telemetry storage остаётся отдельной будущей задачей, если агрегированных counters не хватит.

## Поведение

- Клиент отправляет `POST /api/v1/telemetry` с батчем `events` (1–50). Ответ — `202 Accepted`, `Cache-Control: no-store` и correlation-friendly receipt `{telemetryId, correlationId, receivedAt, accepted}`.
- Типы событий: `FIRST_FRAME` (гость получил первый видеокадр), `PLAYBACK_ERROR` (ошибка воспроизведения у гостя), `PUBLISH_START` / `PUBLISH_FAILURE` (публикация файла host-ом), `QUALITY_SUMMARY` (грубый статус качества) и recovery funnel из WT-630: `RECOVERY_REQUESTED`, `RECOVERY_STARTED`, `RECOVERY_SUCCEEDED`, `RECOVERY_FAILURE`.
- Каждое событие может нести `roomId`, `role`, `detail` — они используются **только** для log-корреляции при triage и никогда не становятся метрик-тегами. Единственный метрик-тег — `qualityStatus` (низкая кардинальность: `GOOD/WARNING/POOR/LOST/UNKNOWN`).
- Backend инкрементирует Micrometer counters `wt.telemetry.first_frame`, `wt.telemetry.publish_start`, `wt.telemetry.publish_failure`, `wt.telemetry.playback_error` и `wt.telemetry.quality{status}`. Они видны на том же actuator `metrics`/`prometheus` surface, что и WT-506, за security-цепочкой.
- Recovery funnel даёт четыре отдельных counter: `wt.telemetry.recovery_requested`, `wt.telemetry.recovery_started`, `wt.telemetry.recovery_succeeded`, `wt.telemetry.recovery_failure`. Он не создаёт per-room историю и не связывает действия guest/host между собой.
- Невалидный payload (пустой `events`, событие без `type`, битые поля) возвращает `422 VALIDATION_FAILED` через общий `ApiExceptionHandler` и соединение не закрывает.
- Frontend: session-scoped tracker переводит сигналы, которые хук сессии уже получает (`remote-playback`, `quality-indicators`, `file-publication`), в telemetry-события. One-shot события (`FIRST_FRAME`, `PUBLISH_START`) дедуплицируются, `QUALITY_SUMMARY` отправляется только при смене грубого статуса, а на disconnect tracker сбрасывается. Отправка best-effort: ошибка beacon-а проглатывается и никогда не всплывает в UX.

### Как считается Successful Watch Session Rate

Метрика агрегированная (counter-based), а не per-session:

- Watch success (guest) ≈ `wt.telemetry.first_frame / (wt.telemetry.first_frame + wt.telemetry.playback_error)`.
- Publish success (host) ≈ `wt.telemetry.publish_start / (wt.telemetry.publish_start + wt.telemetry.publish_failure)`.
- Recovery success (host) ≈ `wt.telemetry.recovery_succeeded / (wt.telemetry.recovery_succeeded + wt.telemetry.recovery_failure)`; `recovery_requested` и `recovery_started` показывают, сколько сигналов дошло до явного действия host-а.
- Широкий знаменатель для контекста — `wt.room.participants.joined` (WT-506).

Точный per-session rate требует хранения событий с session id и остаётся отдельной будущей задачей, если beta evidence покажет, что агрегированных counters недостаточно.

## Реализация

- `contracts/openapi.yaml` — путь `/api/v1/telemetry` и схемы `TelemetryRequest`, `TelemetryEvent`, `TelemetryEventType`, `TelemetryQualityStatus`, `TelemetryResponse`; тег `Telemetry`.
- `backend/.../telemetry/TelemetryController.java` — `POST /api/v1/telemetry`, `202`, `no-store`, correlation id (как feedback).
- `backend/.../telemetry/TelemetryRequest.java`, `TelemetryEvent.java`, `TelemetryEventType.java`, `TelemetryQualityStatus.java`, `TelemetryResponse.java` — bean-validated DTO с ограничениями (батч ≤ 50, `roomId` pattern, `detail` ≤ 200).
- `backend/.../telemetry/TelemetryService.java` — инкремент counters + privacy-safe structured log на каждое событие.
- `backend/.../telemetry/TelemetryMetrics.java` — Micrometer counters поверх общего `MeterRegistry`; quality tagged by `status`.
- `backend/.../config/SecurityConfig.java` — `permitAll` для `POST /api/v1/telemetry` (как feedback).
- `frontend/src/features/telemetry/telemetry-api.ts` — Zod-схемы и `submitTelemetry`.
- `frontend/src/features/telemetry/telemetry.ts` — чистый `createRoomTelemetryTracker` (маппинг состояний в события, дедуп, reset).
- `frontend/src/features/rooms/use-room-session.ts` — tracker подключён к quality/remote-playback `onStateChange`, publish success/failure, guest recovery request и host recovery result; отправка через `submitTelemetry` best-effort.
- `scripts/beta-smoke.mjs`, `scripts/check-infra.mjs` — end-to-end проверка telemetry через gateway.
- Тесты: `TelemetryControllerTest` (контракт + два невалидных случая), `TelemetryServiceTest` (counters + quality tag через `SimpleMeterRegistry`), `telemetry.test.ts` (маппинг/дедуп/reset), `telemetry-api.test.ts` (отправка + problem details).

## Проверка

```bash
pnpm contracts:check
pnpm --filter @watch-together/frontend lint
pnpm --filter @watch-together/frontend typecheck
pnpm --filter @watch-together/frontend test
pnpm backend:test
pnpm infra:up && pnpm infra:check && pnpm beta:smoke
```

Локально в этой задаче проверено:

- `node scripts/check-contracts.mjs` прошёл: OpenAPI с telemetry-путём и схемами валиден.
- backend `TelemetryControllerTest` и `TelemetryServiceTest` прошли: батч по контракту принят, пустой `events` и событие без `type` → `VALIDATION_FAILED`, counters и `quality{status}` инкрементируются.
- frontend `tsc -b`, `eslint . --max-warnings 0` и `vitest run` (20 файлов / 88 тестов) прошли без ошибок.
- `infra:check` и `beta:smoke` против живого локального стека прошли: telemetry принят через gateway (`accepted: 2`, валидный `telemetryId`/`correlationId`).

## Известные ограничения

- Метрика агрегированная (counter-based), не per-session; точный per-session rate требует отдельного storage событий.
- Endpoint публичный, батч ограничен 50 событиями и защищён Redis-backed лимитом из WT-606.
- Raw QoS-числа (RTT, jitter, packet loss, bitrate) telemetry не отправляет — только грубый `qualityStatus`. Детальный QoS/cost benchmark — WT-607.
- Telemetry не персистится: только counters + logs, без экспорта/retention.
- Frontend emit покрывает guest first-frame/playback error и recovery request, host publish start/failure и recovery result, а также смену quality-статуса; тайминговые числа (time-to-first-frame, publish latency) вне области WT-604.
