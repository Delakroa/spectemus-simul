# Документация S² · Spectemus Simul

Эта папка хранит рабочую историю проекта: ADR, отчёты по тикетам, правила качества и заметки по совместимости. Документы ведутся на русском языке. Английские названия оставлены там, где это имена технологий, API-полей, команд, ролей или событий.

## Быстрый порядок чтения

1. [CONVENTIONS.md](CONVENTIONS.md) — базовые правила разработки, приватности, контрактов и тестов.
2. [DEFINITION_OF_DONE.md](DEFINITION_OF_DONE.md) — критерии закрытия тикета.
3. [WT-004_MEDIA_PIPELINE_ADR.md](WT-004_MEDIA_PIPELINE_ADR.md) — ключевое решение по media pipeline.
4. [WT-106_CONTRACTS.md](WT-106_CONTRACTS.md) — contract-first граница REST, WebSocket и ошибок.
5. Документы `WT-201`-`WT-209` — реализованный room lifecycle и первый product UI для него.
6. Документы `WT-301+` — перенос media pipeline из PoC в product-код и стабилизация.

## P0: media proof of concept

- [WT-002_COMPATIBILITY_MATRIX.md](WT-002_COMPATIBILITY_MATRIX.md) — проверенные браузеры, форматы и действия.
- [WT-003_QUALITY_LATENCY.md](WT-003_QUALITY_LATENCY.md) — первые метрики качества и задержки.
- [WT-004_MEDIA_PIPELINE_ADR.md](WT-004_MEDIA_PIPELINE_ADR.md) — принятое решение по media pipeline.
- [WT-004_PRODUCT_STATE.md](WT-004_PRODUCT_STATE.md) — первый прототип playback-state поверх LiveKit data channel.

## P1: foundation

- [WT-101_MONOREPO.md](WT-101_MONOREPO.md) — структура monorepo.
- [WT-102_BACKEND_SKELETON.md](WT-102_BACKEND_SKELETON.md) — Spring Boot backend foundation.
- [WT-103_REACT_FRONTEND.md](WT-103_REACT_FRONTEND.md) — React frontend foundation.
- [WT-104_LOCAL_INFRASTRUCTURE.md](WT-104_LOCAL_INFRASTRUCTURE.md) — локальная Docker Compose среда.
- [WT-105_CI_QUALITY_GATE.md](WT-105_CI_QUALITY_GATE.md) — CI quality gate и security checks.
- [WT-106_CONTRACTS.md](WT-106_CONTRACTS.md) — контракты API, WebSocket events и ошибок.

## P2: room lifecycle

- [WT-201_CREATE_ROOM.md](WT-201_CREATE_ROOM.md) — создание комнаты, TTL и idempotency.
- [WT-202_GUEST_JOIN.md](WT-202_GUEST_JOIN.md) — вход гостя, session identity и вместимость комнаты.
- [WT-203_WEBSOCKET_SNAPSHOT.md](WT-203_WEBSOCKET_SNAPSHOT.md) — авторизованный WebSocket и snapshot при подключении.
- [WT-204_PRESENCE_HEARTBEAT.md](WT-204_PRESENCE_HEARTBEAT.md) — authoritative presence, heartbeat и online/offline fan-out.
- [WT-205_ROOM_CLOSE_EXPIRY.md](WT-205_ROOM_CLOSE_EXPIRY.md) — закрытие комнаты host-ом и expiry.
- [WT-206_PARTICIPANT_LEAVE.md](WT-206_PARTICIPANT_LEAVE.md) — явный выход guest participant и `participant.left`.
- [WT-207_PARTICIPANT_JOINED.md](WT-207_PARTICIPANT_JOINED.md) — событие `participant.joined` для активных WebSocket-сессий.
- [WT-208_FRONTEND_ROOM_EVENTS.md](WT-208_FRONTEND_ROOM_EVENTS.md) — frontend create/join UI и применение room WebSocket events.
- [WT-209_ROOM_SNAPSHOT_RESTORE.md](WT-209_ROOM_SNAPSHOT_RESTORE.md) — восстановление room session после refresh или открытия invite route.

## P3: media integration

- [WT-301_LIVEKIT_PRODUCT_TOKENS.md](WT-301_LIVEKIT_PRODUCT_TOKENS.md) — выдача LiveKit product tokens через backend room/access модель.
- [WT-302_LIVEKIT_CLIENT_CONNECTION.md](WT-302_LIVEKIT_CLIENT_CONNECTION.md) — подключение product frontend к LiveKit room через backend-issued token.
- [WT-303_FILE_DIAGNOSTICS.md](WT-303_FILE_DIAGNOSTICS.md) — диагностика локального видеофайла host-а перед публикацией.
- [WT-304_LIVEKIT_FILE_PUBLISH.md](WT-304_LIVEKIT_FILE_PUBLISH.md) — публикация выбранного локального файла host-а в LiveKit.
- [WT-305_GUEST_LIVEKIT_PLAYBACK.md](WT-305_GUEST_LIVEKIT_PLAYBACK.md) — просмотр remote video/audio tracks гостем.
- [WT-306_PLAYBACK_STATE_SYNC.md](WT-306_PLAYBACK_STATE_SYNC.md) — синхронизация host playback state через LiveKit data channel.

## P4: host UX

- [WT-401_HOST_CONTROLS.md](WT-401_HOST_CONTROLS.md) — управление воспроизведением для host: play/pause/seek, rollback при ошибке.
- [WT-402_HOST_RECONNECT.md](WT-402_HOST_RECONNECT.md) — reconnect host: `HOST_DISCONNECTED`, grace period, восстановление роли, закрытие по таймауту (`HOST_TIMEOUT`).
- [WT-403_TEXT_CHAT.md](WT-403_TEXT_CHAT.md) — текстовый чат комнаты: лимит длины, серверный rate limit, XSS-защита, системные сообщения, эфемерная история.
- [WT-404_VOICE_CHAT.md](WT-404_VOICE_CHAT.md) — voice chat: явное включение микрофона, mute/unmute, отдельные microphone tracks и cleanup.
- [WT-405_QUALITY_INDICATORS.md](WT-405_QUALITY_INDICATORS.md) — privacy-safe индикаторы качества LiveKit: bitrate, packet loss, jitter, RTT и warning states.
- [WT-406_FRONTEND_WEBSOCKET_RECONNECT.md](WT-406_FRONTEND_WEBSOCKET_RECONNECT.md) — frontend auto-reconnect room WebSocket, сохранение локального чата, восстановление host-публикации после LiveKit reconnect и Error UX с recovery-действиями.

## P5: stabilization

- [WT-501_BACKEND_TESTS.md](WT-501_BACKEND_TESTS.md) — backend tests: аудит покрытия по 7 областям и закрытие WebSocket-пробелов (duplicate/stale connection, identity mismatch).
- [WT-502_FRONTEND_TESTS.md](WT-502_FRONTEND_TESTS.md) — frontend tests: player state, cleanup, errors/reconnect, permissions и API contracts.
- [WT-503_MULTI_USER_E2E.md](WT-503_MULTI_USER_E2E.md) — multi-user E2E (Playwright): host + 2 гостя, presence и chat через реальный стек; отдельный `test:e2e` вне `check:ci`.
- [WT-504_NETWORK_RESILIENCE.md](WT-504_NETWORK_RESILIENCE.md) — network resilience: browser offline/reconnect E2E, chat recovery и manual matrix для latency/loss/TURN/VPN.
- [WT-505_SECURITY_HARDENING.md](WT-505_SECURITY_HARDENING.md) — security hardening: аудит модели угроз, CSP/security-заголовки на gateway, secret-scanning (gitleaks) в CI.
- [WT-506_OBSERVABILITY.md](WT-506_OBSERVABILITY.md) — observability: Micrometer room-метрики (WS/lifecycle/host/chat) через actuator/prometheus, privacy-safe.
- [WT-507_CAPACITY_TEST.md](WT-507_CAPACITY_TEST.md) — capacity test: host + 1/2/3 guest, hard limit `4/4`, отказ 5-го участника и runbook CPU/RAM/network.
- [WT-508_BETA_DEPLOYMENT.md](WT-508_BETA_DEPLOYMENT.md) — beta deployment: TLS, secrets, backups, monitoring, rollback, post-deploy smoke, ограничения и privacy/terms draft.

## P6: closed beta

- [WT-601_FEEDBACK.md](WT-601_FEEDBACK.md) — beta feedback: session outcome, reason, optional browser/network metadata, correlation receipt и smoke-check.
- [WT-602_PRODUCT_REVIEW.md](WT-602_PRODUCT_REVIEW.md) — product review: metrics/errors/requests/traffic cost, решение CONTINUE и follow-up backlog.

## P7: beta iteration

- [WT-603_BETA_EVIDENCE_RUN.md](WT-603_BETA_EVIDENCE_RUN.md) — beta evidence run: preflight, Chrome/Edge × host+1/host+3, TURN/UDP matrix, evidence report template и blocker triage.
- [WT-604_CLIENT_TELEMETRY.md](WT-604_CLIENT_TELEMETRY.md) — client telemetry: privacy-safe endpoint и frontend-события (first frame, publish/playback error, quality) для агрегированной Successful Watch Session Rate поверх WT-506 метрик.
- [WT-605_FEEDBACK_OPERATIONS.md](WT-605_FEEDBACK_OPERATIONS.md) — feedback operations: Redis TTL storage, operator export, triage fields и runbook просмотра beta feedback.
- [WT-606_BETA_SECURITY_HARDENING.md](WT-606_BETA_SECURITY_HARDENING.md) — beta security: Redis-backed rate limits (create/join/token/feedback/telemetry), env-управляемый CSP connect-src, HSTS, actuator за Spring Security.
- [WT-607_MEDIA_QOS_COST_BENCHMARK.md](WT-607_MEDIA_QOS_COST_BENCHMARK.md) — media QoS/cost benchmark: JSON-шаблон, summary script, traffic/cost thresholds и scaling gates.

P7 repo-side готов; реальные evidence/QoS отчёты заполняются во время beta/staging прогонов.

## P8: beta evidence & operator tooling

- [WT-608_PRODUCT_REVIEW_REFRESH.md](WT-608_PRODUCT_REVIEW_REFRESH.md) — повторный product review после закрытия P7: обновлённый evidence snapshot, статус beta-гейтов и решение CONTINUE к фактическому прогону invite-only beta. Локальная верификация evidence-пайплайна — в [evidence/](evidence/).
- [WT-609_OPERATOR_DASHBOARD.md](WT-609_OPERATOR_DASHBOARD.md) — operator dashboard поверх WT-605 feedback reports: token-gated UI, summary, filters, details, export и triage actions.

## P9: private review room foundation

- [WT-619_NATIVE_MEDIA_CAPABILITY_FOUNDATION.md](WT-619_NATIVE_MEDIA_CAPABILITY_FOUNDATION.md) — browser-native policy для локальных MP4/M4V и WebM, runtime diagnostics и честные границы codec support.
- [WT-620_PRIVATE_REVIEW_WORKSPACE.md](WT-620_PRIVATE_REVIEW_WORKSPACE.md) — отдельные entry/active room surfaces, media-first workspace, правый chat/participants rail, сворачиваемая диагностика и drag-and-drop local file dock.
- [WT-617_SECURE_SHARE_SHEET.md](WT-617_SECURE_SHARE_SHEET.md) — Copy/QR/Telegram/native Web Share поверх canonical public room URL и mobile desktop handoff без обещания mobile video.
- [WT-610_STAGING_BOOTSTRAP.md](WT-610_STAGING_BOOTSTRAP.md) — Linux VM staging bootstrap: official LiveKit Caddy/TURN foundation и отдельный loopback-only application layer перед реальным evidence run.
- [WT-621_LAN_ROOM_USABILITY.md](WT-621_LAN_ROOM_USABILITY.md) — читаемый LAN workspace, честный HTTPS-статус голоса и предупреждение для `localhost` invite.
- [WT-622_CROSS_PLATFORM_LAN_SETUP.md](WT-622_CROSS_PLATFORM_LAN_SETUP.md) — автоматическая LAN-конфигурация Windows/Mac, корректный LiveKit endpoint и проверка host → guest.
- [WT-623_UNIFIED_REVIEW_THEME.md](WT-623_UNIFIED_REVIEW_THEME.md) — единая тёмная private-review тема для entry, room и пользовательских status/form surfaces.
- [WT-624_WINDOWS_LAN_BOOTSTRAP.md](WT-624_WINDOWS_LAN_BOOTSTRAP.md) — одна Windows-команда с ограниченными Private firewall-правилами, Docker startup и LAN doctor.
- [WT-625_STABLE_CHAT_RAIL.md](WT-625_STABLE_CHAT_RAIL.md) — фиксированный desktop chat rail: история прокручивается внутри панели и не меняет сетку комнаты.
- [WT-626_MEDIA_AUDIO_CONTROLS.md](WT-626_MEDIA_AUDIO_CONTROLS.md) — локальные громкость и mute/unmute для просмотра, плюс recovery аудио после autoplay-block у guest.
- [WT-627_STAGE_CONTROLS_AND_STABLE_SEEK.md](WT-627_STAGE_CONTROLS_AND_STABLE_SEEK.md) — единый auto-hide glass-слой controls и последовательная host-перемотка без визуального рывка progress bar.
- [WT-628_PLAYBACK_RECOVERY.md](WT-628_PLAYBACK_RECOVERY.md) — host recovery выбранного файла: restart tracks без потери позиции или состояния паузы, включая LiveKit reconnect.
- [WT-629_GUEST_RECOVERY_SIGNAL.md](WT-629_GUEST_RECOVERY_SIGNAL.md) — guest сообщает host-у о зависшем видео через privacy-safe LiveKit data message; host сам подтверждает recovery.
- [WT-630_PLAYBACK_RECOVERY_TELEMETRY.md](WT-630_PLAYBACK_RECOVERY_TELEMETRY.md) — privacy-safe агрегированные метрики guest signal → host recovery start → success/failure, без истории сессии или media данных.
- [WT-631_RECOVERY_ACKNOWLEDGEMENT.md](WT-631_RECOVERY_ACKNOWLEDGEMENT.md) — адресное подтверждение guest-у о старте и результате recovery без раскрытия контента и без автоматического действия.
- [WT-632_RECOVERY_REQUEST_CORRELATION.md](WT-632_RECOVERY_REQUEST_CORRELATION.md) — correlation ID связывает recovery request со статусами и защищает новую попытку от запоздавшего результата предыдущей.
- [WT-633_RECOVERY_RESPONSE_TIMEOUT.md](WT-633_RECOVERY_RESPONSE_TIMEOUT.md) — guest получает явный unanswered после таймаута ответа host-а и может повторить recovery request.
- [WT-634_RECOVERY_RESULT_TIMEOUT.md](WT-634_RECOVERY_RESULT_TIMEOUT.md) — started получает конечный timed_out, если итоговый recovery status не дошёл до guest-а.
- [WT-635_WINDOWS_NODE24_PNPM_SPAWN.md](WT-635_WINDOWS_NODE24_PNPM_SPAWN.md) — Windows bootstrap запускает pnpm через ComSpec и не падает с spawn EINVAL на Node.js 24.
- [WT-636_LAN_RECOVERY_UUID_FALLBACK.md](WT-636_LAN_RECOVERY_UUID_FALLBACK.md) — HTTP LAN fallback создаёт recovery UUID без crypto.randomUUID().
- [WT-644_MACOS_HOST_LAUNCHER.md](WT-644_MACOS_HOST_LAUNCHER.md) — запуск host-а двойным кликом на macOS с проверкой Docker и LAN doctor.
- [WT-645_MACOS_DOCKER_AUTOSTART.md](WT-645_MACOS_DOCKER_AUTOSTART.md) — Mac launcher сам открывает Docker Desktop и ждёт его готовности.
- [WT-646_WINDOWS_DOCKER_AUTOSTART.md](WT-646_WINDOWS_DOCKER_AUTOSTART.md) — Windows launcher сам открывает Docker Desktop и ждёт его готовности.
- [WT-647_DESKTOP_HOST_ARCHITECTURE.md](WT-647_DESKTOP_HOST_ARCHITECTURE.md) — решение и поэтапный план обычного desktop host без Docker.
- [WT-648_DESKTOP_BACKEND_PROFILE.md](WT-648_DESKTOP_BACKEND_PROFILE.md) — single-process backend profile без Redis для будущего Electron host.
- [WT-649_ELECTRON_HOST_PROOF.md](WT-649_ELECTRON_HOST_PROOF.md) — Electron supervisor, local sidecars и LAN gateway без Docker.
- [WT-650_DESKTOP_INSTALLER_FOUNDATION.md](WT-650_DESKTOP_INSTALLER_FOUNDATION.md) — packaging, signed release gate и install smoke для DMG/NSIS.
- [WT-651_NATIVE_MEDIA_COMPATIBILITY_POC.md](WT-651_NATIVE_MEDIA_COMPATIBILITY_POC.md) — native-media hypothesis, POC harness, license gate и критерии решения.
- [WT-652_INTERNET_MODE_ARCHITECTURE.md](WT-652_INTERNET_MODE_ARCHITECTURE.md) — отдельный public Internet mode: account/invite, TLS/TURN, privacy, cost gates и последовательность запуска.
- [WT-653_PUBLIC_ACCESS_CONTRACTS.md](WT-653_PUBLIC_ACCESS_CONTRACTS.md) — planned `/api/v2` account/invite/membership contracts без изменения LAN API.
- [WT-657_DESKTOP_INSTALL_SMOKE.md](WT-657_DESKTOP_INSTALL_SMOKE.md) — CI монтирует DMG и устанавливает NSIS, затем проверяет runtime-компоненты готового приложения.
- [WT-658_BROWSER_MEDIA_COMPATIBILITY.md](WT-658_BROWSER_MEDIA_COMPATIBILITY.md) — experimental local decode/capture path для контейнеров за пределами MP4/M4V/WebM без ложного обещания «любой файл».

## Как обновлять документы

- Пишите пользовательский и проектный текст на русском.
- Сохраняйте английские идентификаторы без перевода: `roomId`, `participant.left`, `pnpm check`, `LiveKit`.
- В каждом тикете фиксируйте цель, область, реализованное поведение, проверки и известные ограничения.
- Исторические документы можно уточнять редакторски, но нельзя менять их смысл задним числом без отдельной причины.
