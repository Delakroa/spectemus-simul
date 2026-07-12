# WT-603 Beta evidence run

## Статус

Готово (kit). Этот документ + `scripts/beta-evidence-preflight.mjs` — оснастка прогона. Сам прогон (реальные браузеры, host + гости, staging) — ручная операция вне repo: выполняется человеком, результат фиксируется в заполненной копии шаблона ниже.

## Цель

Провести структурированный evidence-прогон на целевом beta/staging окружении и получить проверяемый ответ: работает ли MVP у реальных пользователей на реальной сети. Результат — заполненный evidence report и список blocker / non-blocker issues, который станет входом в повторный product review (после WT-602 CONTINUE).

Прогон закрывает «слепые пятна», которые WT-602 назвал неизмеримыми до первых сессий: реальная `Successful Watch Session Rate`, first-frame/publish на живой сети, TURN/UDP-blocked path, поведение при host + 3 guest.

## Предусловия (launch gates из WT-602)

Перед приглашением тестеров должно быть выполнено:

- `pnpm beta:evidence:preflight` (против публичного URL) — зелёный;
- `pnpm beta:smoke` против публичного app URL — зелёный;
- деплой на HTTPS, `SESSION_COOKIE_SECURE=true`, `wss://` LiveKit URL, `WT_CSP_CONNECT_SRC` сужен под beta-host, Prometheus/actuator закрыты снаружи;
- ограничения (desktop Chrome/Edge, MP4 H.264/AAC, host + до 3 guest) явно написаны в invite / privacy text.

## Runbook

1. Поднять/проверить целевой стенд. Запустить `WT_BETA_BASE_URL=https://<beta-host> pnpm beta:evidence:preflight` — подтверждает, что evidence-пайплайн (health, telemetry WT-604, feedback intake WT-601, security-заголовки WT-606) жив, и печатает план.
2. `WT_BETA_BASE_URL=https://<beta-host> pnpm beta:smoke` — полный round-trip комнаты/токенов.
3. Ручные smoke перед сессиями: host публикует MP4 → guest видит video/audio → play/pause/seek синхронизируются; отдельно chat, voice, reconnect, room full, feedback.
4. Прогнать сценарии из таблицы ниже (Chrome и Edge × host+1 и host+3), по 15–30 минут просмотра. Для каждой сессии заполнить строку в шаблоне.
5. Один прогон каждой конфигурации повторить на UDP-blocked / TURN-only пути (см. сетевую матрицу) и записать, случился ли fallback и как просел QoS.
6. Снять metric snapshot из Prometheus в конце прогона и посчитать rates.
7. Выгрузить feedback через WT-605 operator export, обновить triage для blocker / non-blocker и перенести `feedbackId` / `correlationId` в evidence report.
8. Свести issues в blocker / non-blocker и вынести verdict против exit-критериев.

## Сценарии

| Браузер | Конфигурация   | Длит.     | Ключевые проверки                                                             |
| ------- | -------------- | --------- | ----------------------------------------------------------------------------- |
| Chrome  | host + 1 гость | 15–30 мин | publish MP4, playback, play/pause/seek sync, chat, voice, reconnect, feedback |
| Chrome  | host + 3 гостя | 15–30 мин | то же + room full (5-й отклонён), quality под нагрузкой                       |
| Edge    | host + 1 гость | 15–30 мин | publish MP4, playback, sync, chat, voice, reconnect, feedback                 |
| Edge    | host + 3 гостя | 15–30 мин | то же + room full, quality под нагрузкой                                      |

## Сетевая матрица

| Путь               | Как воспроизвести                              | Что записать                                        |
| ------------------ | ---------------------------------------------- | --------------------------------------------------- |
| Normal             | обычная сеть                                   | baseline: first frame, sync, quality                |
| UDP-blocked / TURN | заблокировать UDP на клиенте / форс TURN-relay | случился ли fallback, задержка старта, просадка QoS |

## Что смотреть (метрики)

Prometheus (доступ только внутренний). Ключевые counters:

- `wt.telemetry.first_frame` / `wt.telemetry.playback_error` — успех/сбой просмотра у гостей (WT-604);
- `wt.telemetry.publish_start` / `wt.telemetry.publish_failure` — успех публикации у host;
- `wt.telemetry.quality{status}` — распределение качества;
- `wt.room.participants.joined` — широкий знаменатель (WT-506);
- `wt.ratelimit.rejected{bucket}` — должно быть ~0 в контролируемом прогоне (WT-606).

`Successful Watch Session Rate` (определение из master plan / WT-602): доля комнат, где host выбрал файл, хотя бы один guest увидел первый кадр и просмотр длился 10+ минут. В прогоне считается вручную по строкам шаблона (per-session), а counters дают агрегированную проверку.

## Evidence report template

> Скопировать блок в отдельный файл (например `docs/evidence/WT-603_<date>.md`) и заполнить во время прогона. Плейсхолдеры `<…>` заменить.

```
# Beta evidence report — <date>

Стенд: <base URL> · билд/commit: <sha> · оператор: <name>
Предусловия: preflight <pass/fail> · beta:smoke <pass/fail> · HTTPS/wss/secure-cookie <yes/no>

## Сессии

| # | Браузер | Конфиг   | Сеть        | Host publish | ≥1 guest first frame | Watch (мин) | Sync | Chat | Voice | Reconnect | Room full | Feedback (corr id) | Quality | Успешная сессия | Issues |
|---|---------|----------|-------------|--------------|----------------------|-------------|------|------|-------|-----------|-----------|--------------------|---------|-----------------|--------|
| 1 | Chrome  | host+1   | normal      | <Y/N>        | <Y/N>                | <n>         | <Y/N>| <Y/N>| <Y/N> | <Y/N>     | n/a       | <id/->             | <good/…>| <Y/N>           | <ref>  |
| 2 | Chrome  | host+3   | normal      |              |                      |             |      |      |       |           | <Y/N>     |                    |         |                 |        |
| 3 | Edge    | host+1   | normal      |              |                      |             |      |      |       |           | n/a       |                    |         |                 |        |
| 4 | Edge    | host+3   | normal      |              |                      |             |      |      |       |           | <Y/N>     |                    |         |                 |        |
| 5 | Chrome  | host+1   | UDP-blocked |              |                      |             |      |      |       |           | n/a       |                    |         |                 |        |

## Metric snapshot (конец прогона)

first_frame=<n> · playback_error=<n> · publish_start=<n> · publish_failure=<n> · quality{good/warning/poor}=<…> · participants.joined=<n> · ratelimit.rejected=<n>
Watch success = first_frame/(first_frame+playback_error) = <…>
Publish success = publish_start/(publish_start+publish_failure) = <…>
Successful Watch Session Rate (ручной подсчёт по таблице) = <успешные>/<всего> = <…>

## Issues

- [BLOCKER] <описание, шаги, corr id>
- [NON-BLOCKER] <описание>

## Verdict

<CONTINUE / расширять нельзя — причина по exit-критериям>
```

## Blocker vs non-blocker

- **Blocker** — ломает основной сценарий на baseline desktop Chrome/Edge: host не может опубликовать, guest не видит первый кадр, рассинхрон play/pause/seek, комната падает, feedback/telemetry не доходят, утечка приватности.
- **Non-blocker** — известные ограничения из WT-602 (Safari/FF/mobile, MKV/HEVC/DRM, деградация QoS на слабом uplink, косметика UX) или редкие сбои с понятным workaround.

## Exit criteria (нельзя расширять beta, WT-602)

Расширение beta блокируется, если после прогона:

- нет хотя бы нескольких реальных session reports;
- feedback не просматривается регулярно;
- есть незакрытый blocker на baseline;
- TURN/UDP-blocked path не проверен на целевой инфраструктуре;
- LiveKit traffic/cost при host + 3 guest остаётся неизвестным (это добивает WT-607).

## Проверка

```bash
pnpm beta:evidence:preflight   # против живого стенда
pnpm beta:smoke
```

Локально в этой задаче проверено:

- `pnpm beta:evidence:preflight` против локального стека (WT-606 включён) прошёл: health UP, telemetry и feedback intake принимают, CSP с подставленным `connect-src` и HSTS присутствуют; напечатан план прогона.
- Prettier для шаблона и скрипта чист.

## Известные ограничения

- Сами сессии выполняет человек на реальном staging (HTTPS/TLS, `wss://` LiveKit, реальные браузеры, реальная сеть) — их нельзя проиграть из dev-песочницы или CI.
- Preflight проверяет readiness evidence-пайплайна и печатает план; он НЕ заменяет ручной media/voice/reconnect smoke.
- Матрица UDP-blocked/TURN зависит от целевой инфраструктуры (LiveKit + TURN); полноценный QoS/cost benchmark — отдельный WT-607.
- Заполненный evidence report предполагается класть в `docs/evidence/` (создаётся при первом прогоне); в этот тикет входит только шаблон.
