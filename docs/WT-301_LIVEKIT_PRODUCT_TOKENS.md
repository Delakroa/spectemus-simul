# WT-301 LiveKit product tokens

## Статус

Завершено.

## Цель

Перенести выдачу LiveKit token из PoC в product backend: browser с действующей `wt_session` должен получать LiveKit JWT только через backend room/access модель, без API secret во frontend и без ручного ввода identity.

## REST

```http
POST /api/v1/rooms/{roomId}/livekit-token
Cookie: wt_session=...
```

Успешный ответ:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "liveKitUrl": "ws://127.0.0.1:7880",
  "roomName": "AbCdEfGhIjKlMnOpQrStUv",
  "participantId": "d0f8636f-e21e-4d7b-9fce-6fb0e6fb5678",
  "participantIdentity": "d0f8636f-e21e-4d7b-9fce-6fb0e6fb5678",
  "role": "HOST",
  "canPublish": true,
  "canPublishData": true,
  "expiresAt": "2026-07-09T10:10:00Z"
}
```

Поведение ошибок:

- `401 AUTHENTICATION_REQUIRED`, если cookie отсутствует, имеет неверный формат или не относится к комнате;
- `404 ROOM_UNAVAILABLE`, если room ID некорректен, комната не найдена, закрыта или истекла.

## Grants

- Host получает `roomJoin`, `canSubscribe`, `canPublish` и `canPublishData`.
- Guest получает `roomJoin` и `canSubscribe`; publish и data publish запрещены.
- LiveKit `room` совпадает с product `roomId`.
- LiveKit `identity` совпадает с product `participantId`.
- JWT подписывается backend-ом через `LIVEKIT_API_SECRET`; secret не возвращается клиенту и не попадает во frontend bundle.

## Конфигурация

Локальные значения:

```text
LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecretdevsecretdevsecretdevsecret
LIVEKIT_TOKEN_TTL=10m
```

Production должен передавать `LIVEKIT_API_SECRET` через secret storage.

## Frontend

WT-301 добавляет только typed API client для token endpoint. Подключение `livekit-client`, выбор локального файла, publish media tracks и playback controls остаются следующими тикетами.

## Проверка

```bash
pnpm contracts:check
pnpm backend:test
pnpm --filter @watch-together/frontend test
pnpm infra:check
pnpm check
```

Локально в этой задаче проверено:

- `node scripts/check-contracts.mjs` прошёл;
- `./gradlew test --no-daemon` и `./gradlew build --no-daemon` прошли;
- frontend `tsc`, `eslint`, `vitest` и `vite build` прошли через локальные бинарники `frontend/node_modules/.bin`;
- `node scripts/check-infra.mjs` прошёл на свежепересобранном Docker-stack и проверил LiveKit token grants для host/guest через reverse proxy.
- `prettier --check` для изменённых Markdown, YAML, TS/TSX, JS и JSON файлов прошёл;
- `git diff --check` прошёл.

## Известные ограничения

- Token endpoint не создаёт room или participant: сначала нужен create/join/restore.
- WT-301 не добавляет media UI и не публикует audio/video tracks.
- JWT является credential: его нельзя логировать, сохранять в localStorage или кэшировать.
