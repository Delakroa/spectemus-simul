# WT-508 Beta deployment

## Статус

Завершено для repo-side подготовки закрытой beta: добавлены production smoke script, beta runbook, список ограничений, rollback-план и privacy/terms draft. Реальный деплой требует внешнего сервера/домена/секретов и выполняется отдельной операцией.

## Цель

Подготовить проект к invite-only beta без обещания публичного production SLA: задокументировать минимальный безопасный периметр, проверки после выката, rollback и честные ограничения MVP.

## Что добавлено

- `scripts/beta-smoke.mjs` — post-deploy smoke против произвольного `WT_BETA_BASE_URL`:
  - frontend shell и security headers;
  - `gateway-health`, backend `/api/v1/health`, `/api/v1/version`;
  - create room + idempotency;
  - guest join + session cookie attributes;
  - host/guest restore;
  - LiveKit token grants (`HOST`: media+data publish, `GUEST`: media publish для voice, data publish запрещён);
  - room WebSocket snapshot;
  - host close и запрет join в закрытую комнату.
- `package.json` — команда `pnpm beta:smoke`.
- `infra/compose.yaml` — production-ready overrides для публичного LiveKit URL и `node-ip`:
  - `LIVEKIT_URL`;
  - `PUBLIC_LIVEKIT_URL`;
  - `LIVEKIT_NODE_IP`.
- `infra/.env.example` и `infra/README.md` — documented beta overrides.

## Команды

Локально против текущего compose stack:

```bash
pnpm infra:up
pnpm beta:smoke
```

Против beta окружения:

```bash
WT_BETA_BASE_URL=https://watch.example.com \
WT_BETA_LIVEKIT_URL=wss://livekit.example.com \
pnpm beta:smoke
```

Если временный внутренний стенд доступен только по HTTP, smoke можно запустить явно небезопасным override:

```bash
WT_BETA_BASE_URL=http://internal-host:8088 WT_BETA_ALLOW_REMOTE_HTTP=true pnpm beta:smoke
```

Для HTTPS beta smoke по умолчанию требует `Strict-Transport-Security`. Временно отключать можно только для pre-TLS dry run:

```bash
WT_BETA_REQUIRE_HSTS=false pnpm beta:smoke
```

## Deployment checklist

Перед выкладкой:

- PR checks зелёные: contracts, lint, format, typecheck, unit/integration tests, backend build.
- `pnpm infra:check`, `pnpm test:e2e:capacity`, `pnpm test:e2e:network` прогнаны на staging/local full stack.
- Секреты не в git: `REDIS_PASSWORD`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, TLS credentials.
- `SESSION_COOKIE_SECURE=true` для HTTPS.
- `LIVEKIT_URL` и `PUBLIC_LIVEKIT_URL` используют `wss://`.
- CSP `connect-src` на ingress/gateway сужен до app origin + LiveKit host, если beta host фиксирован.
- UDP media range LiveKit открыт только там, где нужен, TCP fallback/TURN documented.
- `/actuator/prometheus` доступен только внутреннему scraper или закрыт сетевым ACL.

После выкладки:

- `pnpm beta:smoke` прошёл против публичного app URL.
- Вручную: Chrome host публикует поддерживаемый MP4, guest получает video/audio, play/pause/seek синхронизируются.
- Вручную: voice включается/выключается, permission denial показывает понятную ошибку.
- Вручную: host + 3 guest остаются в `4/4`; следующий guest получает понятный отказ.
- Проверены dashboards/counters: `wt.ws.connections`, `wt.room.participants.joined`, `wt.room.closed`, `wt.chat.messages`, `wt.chat.rate_limited`.

## TLS

Минимум для invite-only beta:

- HTTPS-only app URL.
- HSTS на TLS termination layer: `Strict-Transport-Security: max-age=31536000; includeSubDomains`.
- `X-Forwarded-Proto` прокидывается до backend/gateway.
- `SESSION_COOKIE_SECURE=true`.
- LiveKit signaling только `wss://`; media UDP/TCP fallback открыт по documented ports.
- Сертификаты обновляются автоматически или имеют календарный alert до expiry.

## Backups

Сейчас product state эфемерен:

- видеофайлы не хранятся сервером;
- room/session/chat state живёт в Redis с TTL;
- PostgreSQL пока не содержит product state.

Для beta backup scope:

- секреты и `.env` хранятся в secret storage / password manager;
- deployment manifests и image tags фиксируются в release notes;
- Redis AOF/volume snapshot нужен только для короткого восстановления активных комнат и не является источником долгосрочных данных;
- PostgreSQL volume snapshot включить до появления persistent user/feedback state, чтобы процедура была готова заранее.

## Monitoring

Минимальный dashboard:

- uptime app/gateway/backend/LiveKit;
- HTTP 5xx/4xx rate по gateway/backend;
- room lifecycle counters из WT-506;
- host disconnect/reconnect counters;
- chat rate limit counter;
- container CPU/RAM/restarts;
- LiveKit connection/packet-loss/TURN indicators, если доступны на deployment layer;
- TLS certificate expiry.

Минимальные alerts:

- app health недоступен 2 минуты;
- backend/gateway/LiveKit restart loop;
- рост `wt.room.closed{reason="HOST_TIMEOUT"}`;
- резкий рост `wt.chat.rate_limited`;
- TLS certificate expires < 14 дней.

## Rollback

Rollback должен быть проще hotfix:

1. Зафиксировать текущий image tag / commit SHA перед deploy.
2. Перед deploy сохранить текущий `.env`/secret version reference и compose/infra manifest.
3. Если `beta:smoke` или ручной smoke падает, переключить gateway/backend/livekit на предыдущий image tag.
4. Не запускать destructive volume reset в beta без отдельного решения: активные комнаты эфемерны, но reset оборвёт все текущие сессии.
5. После rollback повторить `pnpm beta:smoke`.
6. В release notes записать причину rollback и user-visible impact.

## Invite-only policy

- Beta link выдаётся вручную ограниченному списку участников.
- Лимит MVP: одна комната = host + максимум 3 guest.
- Не обещаем поддержку mobile/Safari/Firefox как beta-ready.
- Не обещаем работу с DRM/защищёнными потоками, MKV/DTS/HEVC и любыми файлами за пределами documented MP4/H.264/AAC baseline.
- Не обещаем сохранение комнаты после expiry/restart.
- Пользователь должен использовать только контент, который имеет право смотреть совместно.

## Privacy / terms draft

Короткий текст для beta-страницы/инвайта:

> Watch Together не загружает выбранный видеофайл на сервер приложения и не хранит байты фильма. Host передаёт медиапоток через LiveKit/WebRTC другим участникам комнаты. Сервис хранит только техническое состояние комнаты, session cookies, ephemeral chat и агрегированные метрики качества/надёжности, необходимые для работы beta. Не используйте сервис для контента, на совместный просмотр которого у вас нет прав.

Что нужно явно раскрыть:

- файл остаётся на устройстве host, но media stream идёт через LiveKit/SFU;
- room/chat/session state эфемерен и может исчезнуть при restart/expiry;
- агрегированные метрики не содержат `roomId`, `participantId`, имён, IP в metric labels или содержимого медиа;
- beta может быть нестабильной, без SLA;
- invite-only доступ может быть отозван.

## Beta limitations

- Desktop Chromium baseline; Edge smoke нужен перед расширением support claims.
- Нет media QoS guarantee для host + 3 guest: зависит от uplink host, NAT/TURN и файла.
- Нет accounts/PIN/moderation.
- Нет persistent history.
- Нет full production incident process; rollback manual.
- TURN-only и UDP-blocked сценарии требуют отдельной deployment evidence.

## Проверка

Локально в задаче проверено:

- `node --check scripts/beta-smoke.mjs`;
- `docker compose -f infra/compose.yaml config`;
- `node scripts/beta-smoke.mjs` против локального compose stack: passed;
- `node scripts/check-infra.mjs` против локального compose stack: passed;
- `pnpm format:check`;
- `node scripts/check-contracts.mjs`;
- `git diff --check`.

## Definition of done

- Документированы TLS, backups, monitoring, rollback, smoke, limitations и privacy/terms draft.
- Добавлена автоматизированная post-deploy smoke-команда.
- Локальный smoke против compose stack прошёл.
- Source of truth в яндекс-пакете обновлён.
