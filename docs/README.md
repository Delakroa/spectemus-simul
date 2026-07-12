# Документация Watch Together

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
- [WT-505_SECURITY_HARDENING.md](WT-505_SECURITY_HARDENING.md) — security hardening: аудит модели угроз, CSP/security-заголовки на gateway, secret-scanning (gitleaks) в CI.

## Как обновлять документы

- Пишите пользовательский и проектный текст на русском.
- Сохраняйте английские идентификаторы без перевода: `roomId`, `participant.left`, `pnpm check`, `LiveKit`.
- В каждом тикете фиксируйте цель, область, реализованное поведение, проверки и известные ограничения.
- Исторические документы можно уточнять редакторски, но нельзя менять их смысл задним числом без отдельной причины.
