# WT-209 Room snapshot restore

## Статус

Завершено.

## Цель

Восстановить room session после refresh или повторного открытия `/rooms/{roomId}`: browser с действующей `wt_session` должен получить текущего participant, authoritative room snapshot и снова подключить room WebSocket без повторного create/join.

## REST

```http
GET /api/v1/rooms/{roomId}
Cookie: wt_session=...
```

Успешный ответ:

```json
{
  "participant": {
    "participantId": "8e7d79a8-a49f-48cc-a409-f07890dd3218",
    "displayName": "Guest",
    "role": "GUEST",
    "online": true,
    "joinedAt": "2026-07-09T07:30:05Z"
  },
  "room": {
    "roomId": "AbCdEfGhIjKlMnOpQrStUv",
    "status": "READY",
    "hostParticipantId": "d0f8636f-e21e-4d7b-9fce-6fb0e6fb5678",
    "participants": [
      {
        "participantId": "d0f8636f-e21e-4d7b-9fce-6fb0e6fb5678",
        "displayName": "Host",
        "role": "HOST",
        "online": true,
        "joinedAt": "2026-07-09T07:20:00Z"
      },
      {
        "participantId": "8e7d79a8-a49f-48cc-a409-f07890dd3218",
        "displayName": "Guest",
        "role": "GUEST",
        "online": true,
        "joinedAt": "2026-07-09T07:30:05Z"
      }
    ],
    "media": null,
    "roomVersion": 3,
    "expiresAt": "2026-07-09T11:20:00Z",
    "updatedAt": "2026-07-09T07:30:05Z"
  }
}
```

Поведение ошибок:

- `401 AUTHENTICATION_REQUIRED`, если cookie отсутствует, имеет неверный формат или не относится к комнате;
- `404 ROOM_UNAVAILABLE`, если room ID некорректен, комната не найдена, закрыта или истекла.

## Frontend

- При открытии `/rooms/{roomId}` frontend автоматически вызывает `GET /api/v1/rooms/{roomId}`.
- После успешного restore frontend показывает комнату, текущего participant и открывает WebSocket `/api/v1/rooms/{roomId}/events`.
- Heartbeat использует participant identity из restore response.
- Host secret не возвращается backend повторно. Frontend сохраняет его в `sessionStorage` только после create, чтобы host мог закрыть комнату после refresh в том же browser session.
- Если host открывает комнату в другом браузере/профиле без сохранённого host secret, snapshot восстановится, но закрытие комнаты вернёт ошибку доступа.

## Проверка

```bash
pnpm contracts:check
pnpm backend:test
pnpm --filter @watch-together/frontend test
pnpm infra:check
pnpm check
pnpm security:audit
```

Локально в этой задаче проверено:

- `node scripts/check-contracts.mjs` прошёл;
- `./gradlew test --no-daemon` и `./gradlew build --no-daemon` прошли;
- frontend `tsc`, `eslint`, `vitest` и `vite build` прошли через локальные бинарники `frontend/node_modules/.bin`;
- `node --check scripts/check-infra.mjs` прошёл;
- `node scripts/check-infra.mjs` прошёл на свежепересобранном Docker-stack и проверил restore host/guest через reverse proxy;
- `prettier --check` для изменённых Markdown, YAML, TS/TSX, JS и JSON файлов прошёл;
- `git diff --check` прошёл.

`scripts/check-infra.mjs` расширен: теперь он проверяет restore host/guest через reverse proxy. Для `pnpm infra:check` нужен свежепересобранный Docker-stack; если stack собран до WT-209, `GET /api/v1/rooms/{roomId}` может возвращать старый `403`.

## Известные ограничения

- Restore не создаёт новую participant identity: если cookie отсутствует, гость должен снова войти через join.
- Host secret сохраняется только в `sessionStorage` текущего browser session и не синхронизируется между браузерами или профилями.
- WT-209 не добавляет выбор видео, LiveKit product tokens и playback controls.
