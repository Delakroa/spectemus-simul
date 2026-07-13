# WT-608 Product review refresh (beta evidence execution)

## Статус

Сделано (review refresh + локальная evidence-верификация). Это повторный product review, обещанный в WT-602 («затем закрыть WT-603-WT-607 и повторить product review уже на реальных данных»), после того как весь P7-пакет влит.

## Решение

**CONTINUE — переходить к фактическому прогону invite-only beta.**

Repo-side готовность к beta теперь **полная**: все технические ADJUST-пункты из WT-602 закрыты в коде или оснащены tooling-ом. Оставшийся гейт — **не репозиторный**: реальные пользовательские сессии на TLS-staging и реальные сеть/стоимость. Их нельзя собрать из repo — это операция (деплой + живые тестеры).

Расширять beta или обещать GA по-прежнему **нельзя**, пока не собран реальный evidence (WT-603 run + WT-607 QoS на staging). Это не регресс, а честная граница: код готов, данных по людям ещё нет.

## Что изменилось с WT-602

WT-602 требовал ADJUST по пяти направлениям. Статус сейчас:

| ADJUST (WT-602)        | Тикет  | Состояние                                                                              |
| ---------------------- | ------ | -------------------------------------------------------------------------------------- |
| Client telemetry       | WT-604 | **Закрыто в коде**: `Successful Watch Session Rate` измерима (counters/logs)           |
| Feedback operations    | WT-605 | **Закрыто в коде**: Redis storage, operator list/export/triage, token-gate             |
| REST rate limiting     | WT-606 | **Закрыто в коде**: distributed Redis лимиты, `429`+`Retry-After`, CSP/HSTS            |
| Real network evidence  | WT-603 | **Tooling готов** (runbook + preflight + report template); данные — за прогоном        |
| Traffic cost benchmark | WT-607 | **Tooling готов** (QoS/cost summary + thresholds + scaling gates); цифры — за прогоном |

3 из 5 закрыты полностью в коде; 2 оснащены и ждут только внешнего прогона.

## Обновлённый evidence snapshot

| Область        | Было (WT-602)                                     | Стало (WT-608)                                                                    |
| -------------- | ------------------------------------------------- | --------------------------------------------------------------------------------- |
| Observability  | room counters есть; client telemetry нет          | client first-frame/publish/playback/quality telemetry есть (WT-604)               |
| Feedback       | только structured logs                            | managed: storage/TTL, operator export, triage поля, runbook (WT-605)              |
| Security       | базовый периметр; distributed rate limiting нужен | Redis rate limits на create/join/token/feedback/telemetry; env-CSP; HSTS (WT-606) |
| Media QoS/cost | неизвестны при host + 3                           | benchmark kit + пороги + scaling-гейты; замеры за оператором (WT-607)             |
| Evidence run   | нет процесса                                      | runbook + semi-auto preflight + fillable report (WT-603)                          |

Локальная проверка пайплайна (2026-07-13) подтвердила все интейки end-to-end: см. [evidence/WT-608_2026-07-13.md](evidence/WT-608_2026-07-13.md). Это синтетический прогон, не пользовательский.

## Метрика

`Successful Watch Session Rate` больше **не является неизмеримой** (главная претензия WT-602). Пайплайн WT-604 даёт вычислимую метрику: на синтетическом прогоне watch success = 4/5 = 80%, publish success = 2/2 = 100% (демонстрация вычислимости, не реальные числа).

Чего всё ещё нет: **реальных** значений. Точная per-session метрика с длительностью 10+ минут появляется только из живых сессий; counter-based агрегат — приемлемый beta-прокси до тех пор.

## Beta gates

Launch gates из WT-602 остаются в силе и теперь автоматизированы там, где возможно:

- `pnpm beta:evidence:preflight` + `pnpm beta:smoke` против публичного URL — оба зелёные локально; на staging требуют реального URL;
- HTTPS, `SESSION_COOKIE_SECURE=true`, `wss://` LiveKit, суженный `WT_CSP_CONNECT_SRC`, закрытый Prometheus/actuator — **репозиторно готово**, применяется на деплое;
- ручные media/voice/reconnect smoke + ограничения в invite/privacy text — за оператором.

Cannot-expand гейты (WT-602) — обновление:

| Гейт «нельзя расширять, если…»                | Статус                                                     |
| --------------------------------------------- | ---------------------------------------------------------- |
| нет реальных session reports                  | **открыт** — нужен внешний прогон                          |
| feedback не просматривается                   | **закрыто** — WT-605 даёт review/triage/export             |
| first-frame/publish не измеряются             | **закрыто** — WT-604                                       |
| TURN/UDP-blocked не проверен на целевой инфре | **открыт** — нужен внешний прогон (WT-603 сетевая матрица) |
| LiveKit traffic/cost при host + 3 неизвестны  | **открыт** — нужен WT-607 замер на staging                 |

## Traffic and cost review

Модель не изменилась с WT-602: главный cost/risk — LiveKit media egress, растущий с числом guest; TURN/TCP fallback дорожает. Лимит `4/4` остаётся safety rail. Отличие теперь — есть **инструмент** для цифр (WT-607: measured GB, GB/hour, $/hour, PASS/WARN/FAIL) и явные scaling-гейты. Решение не поднимать лимит выше `4/4` до реального WT-607 замера — в силе.

## Что нельзя закрыть из repo

Честная граница этого review — следующее требует деплоя и людей, не кода:

- реальные user-сессии в Chrome/Edge на TLS staging (первый кадр, sync, 10+ мин, voice, reconnect, room full);
- TURN/UDP-blocked media path на целевой инфраструктуре;
- реальные LiveKit egress/cost при `host + 3` (WT-607 JSON → `pnpm beta:qos:summary`);
- внешний сервер/домен/секреты/TLS (WT-508 runbook описывает, но не выполняет).

## Следующий шаг

1. Задеплоить текущий build на invite-only staging c TLS/секретами (WT-508), задать `FEEDBACK_ADMIN_TOKEN`, сузить `WT_CSP_CONNECT_SRC`.
2. Оператору выполнить WT-603 evidence run + WT-607 QoS замеры с реальными тестерами; заполнить `docs/evidence/` reports.
3. Разобрать feedback (WT-605 export/triage), свести blocker/non-blocker.
4. Финальный go/expand review — уже на реальных данных, для решения о снятии ограничений или расширении.

## Проверка

```bash
pnpm beta:evidence:preflight
pnpm beta:smoke
pnpm infra:check
```

Локально в этой задаче проверено (2026-07-13, локальный стек, свежая сборка backend с текущего дерева):

- preflight / `beta:smoke` / `infra:check` — зелёные;
- WT-605 operator flow (submit → list → triage → export → 403 без токена) — работает через gateway;
- WT-604 telemetry — 9 синтетических событий приняты и подтверждены в логах, метрика вычислима;
- WT-606 — CSP `connect-src` подставлен, HSTS присутствует, лимиты активны.

Детали: [evidence/WT-608_2026-07-13.md](evidence/WT-608_2026-07-13.md).

## Известные ограничения

- Это review + верификация пайплайна, не пользовательское evidence. Реальные числа метрики/QoS/cost появятся только после внешнего прогона.
- Локальная верификация синтетическая (инъекция telemetry, один feedback), на HTTP-стеке; TLS/secure-cookie/wss проверяются только на staging.
- Решение CONTINUE — про сбор evidence на контролируемой invite-only beta, а не про GA или расширение аудитории.
