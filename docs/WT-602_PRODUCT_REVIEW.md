# WT-602 — Product review

## Статус

Сделано.

## Решение

**CONTINUE** для ограниченной invite-only beta.

Это не решение о публичном запуске и не обещание production SLA. Текущий результат достаточно зрелый, чтобы дать продукт небольшому числу доверенных пользователей при жёстких ограничениях: desktop Chrome/Edge, MP4 H.264/AAC, host + максимум 3 guest, ручной invite и обязательный post-deploy smoke.

Перед расширением beta или переходом к GA нужен **ADJUST** по telemetry, feedback operations, real network evidence, REST rate limiting и traffic cost benchmark.

## Цель review

Сверить готовность MVP после WT-601: метрики, ошибки, пользовательские запросы, стоимость трафика, ограничения и следующий backlog. Review фиксирует не красивые надежды, а проверяемую границу: куда можно идти сейчас и что ещё опасно обещать.

## Evidence snapshot

| Область        | Evidence                                                                                                  | Вывод                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Media pipeline | P0 подтвердил локальный MP4 -> `captureStream()` -> LiveKit -> guest; Chrome long-run 27 минут; Edge PASS | Основная гипотеза доказана для desktop Chromium baseline                                   |
| Room lifecycle | WT-201-WT-209: create/join/session/WS snapshot/presence/leave/close/restore                               | Product flow собран вокруг backend authority и Redis TTL                                   |
| Media product  | WT-301-WT-306: backend LiveKit tokens, frontend connection, file diagnostics, publish, guest playback     | Media integration перенесена из PoC в product-код                                          |
| Watch UX       | WT-401-WT-406: host controls, reconnect, chat, voice, quality indicators, recoverable Error UX            | Пользовательский сценарий достаточно цельный для закрытой beta                             |
| Tests          | WT-501-WT-504, WT-507: backend/frontend suites, multi-user E2E, offline reconnect, capacity               | Core signaling/UI flows автоматизированы; heavy E2E остаётся вне `check:ci`                |
| Security       | WT-505: threat-model audit, security headers/CSP, secret scanning                                         | Базовый beta-периметр закрыт; distributed REST rate limiting ещё нужен                     |
| Observability  | WT-506: Micrometer room counters через actuator/prometheus                                                | Есть backend room funnel/reconnect/chat counters; нет client first-frame/publish telemetry |
| Deployment     | WT-508: beta smoke, TLS/backup/monitoring/rollback/privacy runbook                                        | Repo-side beta deployment готов; внешний сервер/домен/секреты всё ещё отдельная операция   |
| Feedback       | WT-601: feedback endpoint, UI, optional privacy-safe metadata, correlation receipt                        | Можно собирать qualitative beta-сигналы через backend logs                                 |

## Metrics review

Главная продуктовая метрика из master plan — `Successful Watch Session Rate`: комната, где host выбрал файл, хотя бы один guest увидел первый кадр и просмотр длился 10+ минут.

Сейчас эта метрика **ещё не измеряется автоматически**:

- backend знает room lifecycle, join/leave/close/reconnect/chat;
- frontend показывает local quality indicators, но не отправляет first-frame/publish/playback telemetry в backend;
- feedback собирается как structured log, но не имеет persisted dashboard/export;
- beta traffic пока локальный/staging-like, а не реальные пользовательские сессии.

Промежуточный вывод: product review не может честно сказать “70% достигнуто”. Он может сказать: foundation готов для сбора этой метрики в beta, но сама метрика станет реальной только после WT-604 и первых beta-сессий.

## Errors and risk review

### Приемлемо для invite-only beta

- Неподдерживаемый файл даёт понятную ошибку через file diagnostics.
- Host reconnect и frontend WebSocket reconnect покрыты отдельными задачами.
- Room full (`4/4`) возвращает понятный отказ.
- Chat/voice существуют как базовая коммуникация внутри комнаты.
- Feedback доступен прямо из UI и даёт correlation id.

### Нельзя обещать широкой аудитории

- Safari/Firefox/mobile не являются beta-ready.
- MKV/HEVC/DTS/DRM/потоковые кинотеатры вне scope.
- Media QoS для host + 3 guest зависит от uplink host, NAT/TURN и конкретного файла.
- TURN-only/UDP-blocked сценарии пока не имеют deployment evidence.
- Feedback пока в логах, без persistent review queue.
- REST per-endpoint rate limiting объявлен контрактом, но не реализован распределённо.
- Client first-frame, publish failure, TURN ratio и long-session quality не собираются в backend.

## Traffic and cost review

Backend/gateway cost для MVP невысокий: REST, WebSocket events, Redis TTL state и lightweight metrics. Главный cost/risk — LiveKit media path.

Модель трафика для одной комнаты:

- host публикует один video/audio stream в LiveKit;
- LiveKit egress растёт примерно по числу guest subscriptions;
- voice chat добавляет microphone tracks, но они существенно легче movie video;
- TURN/TCP fallback может резко увеличить bandwidth cost и latency;
- ограничение `host + 3 guest` — текущий safety rail, а не масштабная цель.

Решение: не поднимать лимит комнаты выше `4/4`, пока нет WT-607 media QoS/cost benchmark на фиксированном видео, с host + 1/2/3 guest, LiveKit/TURN stats и CPU/RAM/network sampling.

## User requests and feedback

Реальных beta-запросов ещё нет. С WT-601 появился канал, через который можно собирать:

- сработал ли сценарий;
- причина сбоя;
- комментарий пользователя;
- optional browser/network/room metadata;
- correlation id для сопоставления с backend logs.

До первых beta-сессий это считается readiness channel, а не evidence по пользовательскому спросу.

## Beta gates

Можно запускать ограниченную beta, если перед инвайтом выполнено:

- `pnpm beta:smoke` прошёл против публичного app URL;
- ручной smoke: host публикует MP4, guest получает video/audio, play/pause/seek синхронизируются;
- ручной smoke: voice, chat, reconnect, room full, feedback;
- deployment использует HTTPS, `SESSION_COOKIE_SECURE=true`, `wss://` LiveKit URL и закрытый Prometheus access;
- ограничения явно написаны в invite/privacy text.

Нельзя расширять beta, если:

- нет хотя бы нескольких реальных session reports;
- feedback не просматривается регулярно;
- first-frame/publish failure всё ещё не измеряются;
- TURN/UDP-blocked path не проверен на целевой инфраструктуре;
- LiveKit traffic/cost неизвестны при host + 3 guest.

## Follow-up backlog

### WT-603 — Beta evidence run

Провести ручной и полуавтоматический прогон на целевом beta/staging окружении: Chrome/Edge, host + 1 guest, host + 3 guest, 15-30 минут просмотра, chat/voice/reconnect/feedback, UDP-blocked/TURN checklist. Результат: заполненный evidence report и список blocker/non-blocker issues.

### WT-604 — Client telemetry

Добавить privacy-safe telemetry endpoint и frontend events для first frame, publish failure, playback start, playback error, quality summary и optional TURN/network hints. Результат: beta может считать `Successful Watch Session Rate`.

### WT-605 — Feedback operations

Перевести feedback из “только logs” в управляемый beta процесс: storage/export, triage fields, retention policy, basic rate limiting и runbook просмотра отзывов.

### WT-606 — Beta security/rate-limit hardening

Добавить Redis-backed rate limits для create/join/token/feedback, сузить CSP `connect-src` под фиксированный beta host, зафиксировать HSTS evidence и gateway/actuator access checklist.

### WT-607 — Media QoS and traffic cost benchmark

Собрать benchmark на фиксированном MP4: host + 1/2/3 guest, LiveKit stats, TURN/TCP fallback, CPU/RAM/network sampling, примерная стоимость трафика и критерий масштабирования.

### WT-641 — Уточнение размещения recovery-действия (самый низкий приоритет)

Только если beta-пользователи начнут случайно нажимать ⚠️ рядом с fullscreen или путать его с обычным контролом: перенести действие «Проблема с видео» в правый верхний угол плеера и добавить короткую подпись. Сейчас проблем не зафиксировано, поэтому работа откладывается до завершения остальных backlog-задач и появления реальных feedback-сигналов.

### WT-642 — Публичные аккаунты и безопасные приглашения

После развёртывания публичного HTTPS/TURN-контура добавить пользовательский слой для людей, не работающих с GitHub, Docker или локальной сетью:

- вход без пароля по одноразовому коду или magic link из подтверждённого email; первая успешная проверка создаёт аккаунт;
- отдельные persistent user/account sessions, не смешанные с текущими короткоживущими room session credentials;
- account owner для комнаты, dashboard собственных комнат и возможность закрыть/revoke invite;
- invite link даёт доступ только после входа или быстрой регистрации гостя; expiry, revocation и rate limits защищают от случайной публикации и злоупотреблений;
- PostgreSQL-хранилище users, invite/membership state и базовых account limits; privacy notice, удаление аккаунта и операционный runbook.

Начинать с passwordless email flow, а не с паролей: не нужен собственный password storage/recovery, а путь для нового гостя остаётся простым. Реализация требует публичного домена, HTTPS, email provider и секретов; до их появления работа остаётся архитектурным backlog, а не локальной функцией.

## Проверка

WT-602 — документационный review, код runtime не меняет. Для подтверждения текущего состояния нужно прогнать:

```bash
node scripts/check-contracts.mjs
node scripts/check-infra.mjs
node scripts/beta-smoke.mjs
node_modules/.bin/prettier --check README.md docs/README.md docs/WT-602_PRODUCT_REVIEW.md package.json
```

## Итог

Текущий MVP готов к контролируемому сбору beta evidence, но не готов к расширению обещаний. Правильное движение — **CONTINUE в invite-only beta**, затем закрыть WT-603-WT-607 и повторить product review уже на реальных данных.
