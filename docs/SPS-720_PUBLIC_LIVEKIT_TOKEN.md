# SPS-720 — короткоживущий LiveKit token для Internet-комнаты

## Цель

Выдавать `POST /api/v2/public-rooms/{publicRoomId}/livekit-token` только account
с действующей session и активным membership в открытой неистёкшей
Internet-комнате. LAN `POST /api/v1/rooms/{roomId}/livekit-token` не меняется.
Internet mode для пользователей по-прежнему выключен.

## Security boundary

- Cookie `wt_account`; отсутствие, битый формат, неизвестная или истёкшая
  session → `401 ACCOUNT_REQUIRED`.
- Нет membership, revoke, closed/expired/unknown room → одинаковый
  `404 MEMBERSHIP_REQUIRED` без oracle о существовании комнаты или owner.
- Permission checks выполняются до подписи JWT.
- Token, API secret, account cookie и invite token не логируются.
- Ответ: `Cache-Control: no-store`.
- Rate-limit bucket `livekit-token` покрывает и LAN, и public path.

## Конфигурация

Отдельный fail-closed блок `spectemus-simul.public-livekit` (по умолчанию
выключен). Не использует LAN `spectemus-simul.livekit` и не собирает URL из
`Host`.

| Параметр / env              | Назначение                                    |
| --------------------------- | --------------------------------------------- |
| `PUBLIC_LIVEKIT_ENABLED`    | Явный switch endpoint-а                       |
| `PUBLIC_LIVEKIT_RTC_URL`    | Browser URL; обязателен `wss://`, не loopback |
| `PUBLIC_LIVEKIT_API_KEY`    | Не `devkey`                                   |
| `PUBLIC_LIVEKIT_API_SECRET` | Не LAN/default secret                         |
| `PUBLIC_LIVEKIT_TOKEN_TTL`  | Положительный TTL, максимум 15m (default 5m)  |

`PUBLIC_LIVEKIT_URL` во frontend build остаётся отдельной переменной и не
подписывает JWT. Неполная включённая конфигурация останавливает binding.
Реальные credentials и домены в git не добавляются.

Endpoint создаётся только при `PUBLIC_ACCESS_ENABLED=true` и
`PUBLIC_LIVEKIT_ENABLED=true`.

## Grants

| Membership | Media role | canPublish | canPublishSources | canPublishData |
| ---------- | ---------- | ---------- | ----------------- | -------------- |
| OWNER      | HOST       | true       | (все / omit)      | true           |
| GUEST      | GUEST      | true       | `microphone`      | true           |

Подпись — общий `LiveKitTokenSigner` (без второго JWT signer).

## Identity

Domain-separated HMAC через `PublicAccessSecrets` и identity pepper:

- `livekit-room` → opaque `roomName` (43 base64url);
- `livekit-identity` → opaque `participantIdentity` (room-scoped);
- `livekit-participant-id` → deterministic UUID `participantId`.

В JWT нет email, account session, invite token и raw credentials. Сырой
account UUID не используется как глобальная LiveKit identity. Один account в
разных комнатах получает разные identity; повторный token в одной комнате —
стабильный.

## Контракт roomName

LAN `LiveKitTokenResponse.roomName` остаётся `RoomId` (22 символа). Public
ответ — отдельная схема `PublicLiveKitTokenResponse` с opaque `roomName`, чтобы
не передавать UUID через LAN-схему и не ослаблять RoomId.

## Ошибки

| Условие                                           | HTTP | code                  |
| ------------------------------------------------- | ---: | --------------------- |
| Нет / битая / истёкшая session                    |  401 | `ACCOUNT_REQUIRED`    |
| Non-member / revoked / closed / expired / unknown |  404 | `MEMBERSHIP_REQUIRED` |

## Проверки

- `git diff --check` — без замечаний
- `./gradlew :backend:test --no-daemon` — BUILD SUCCESSFUL, 161 тест
- `pnpm contracts:check` — ok
- `pnpm check` — успешно

## Откат

`PUBLIC_LIVEKIT_ENABLED=false`. Endpoint и bean исчезают; LAN token и
`/api/v1` не затрагиваются. Полный откат тикета возвращает OpenAPI status
`planned` и убирает public-livekit конфигурацию.

## Ограничения

- Frontend Internet flow, экран входа, включение Internet mode пользователям —
  вне тикета.
- Revoke уже подключённого LiveKit participant — отдельный тикет.
- LiveKit Server API, TURN, DNS/VM/TLS, PostgreSQL/SMTP provisioning,
  telemetry, реальные секреты — вне тикета.
- Физический Mac ↔ Windows и installer-сборки — вне тикета.

## Следующий gate

Запрет token после revoke уже покрыт membership check. Дальше: disconnect
active participant через LiveKit Server API, публичные WSS/TURN и диагностика
сети. Internet mode остаётся выключенным до staging gate.
