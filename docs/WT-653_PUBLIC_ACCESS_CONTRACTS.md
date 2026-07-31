# WT-653 — Public access contracts

## Статус

Завершено как contract-first design. WT-654 реализует account, PostgreSQL
migration, SMTP delivery и membership/invite endpoints за явным
`PUBLIC_ACCESS_ENABLED` switch. До WT-655 `livekit-token`, frontend UI и
public deploy остаются `planned`.

## Цель

Зафиксировать до реализации безопасную границу account, invite и membership,
чтобы режим «посмотреть из разных городов» не превратил текущую LAN room link
в постоянный публичный credential.

## Принятые контракты

### LAN остаётся на `/api/v1`

Текущие room lifecycle, `wt_session`, `/rooms/{roomId}` и host secret не
меняются. Public Internet mode начинается отдельной `/api/v2` surface и
отдельной cookie `wt_account`; эти credentials не смешиваются.

### Passwordless account

| Шаг              | Planned endpoint                                          | Инвариант                                                            |
| ---------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| Запрос challenge | `POST /api/v2/auth/email-challenges`                      | Всегда `202`, поэтому email нельзя проверить через response          |
| Подтверждение    | `POST /api/v2/auth/email-challenges/{challengeId}/verify` | Одноразовый code write-only; ставится HttpOnly/Secure account cookie |
| Текущий account  | `GET /api/v2/account`                                     | Возвращает минимальный profile без email и credentials               |

Raw одноразовый code не возвращается API, не хранится в localStorage и не
добавляется в telemetry. Реальная отправка требует настроенный SMTP provider,
подтверждённый sender address и HTTPS origin; без них switch не включается.

### Invite не является media credential

Owner создаёт invite через
`POST /api/v2/public-rooms/{publicRoomId}/invites`. Raw token длиной 32 random
bytes возвращается только один раз как `/join#invite=<token>`:

- fragment не отправляется HTTP server-у и не попадает в server access logs;
- frontend отправляет token только в write-only body
  `POST /api/v2/invite-redemptions`;
- в PostgreSQL должен храниться только hash token-а;
- response redemption возвращает membership, но никогда не LiveKit JWT;
- invite имеет expiry, лимит redemption и owner revoke.

Это сильнее, чем `/join/{token}` или query parameter: в них bearer token легко
окажется в access log, analytics, Referer или скриншоте маршрута.

### Membership предшествует media access

`PublicRoomAccess` объединяет room record и membership текущего account.
Только он открывает planned
`POST /api/v2/public-rooms/{publicRoomId}/livekit-token`. Роли membership
минимальны: `OWNER` и `GUEST`; media роль (`HOST`/`GUEST`) остаётся кратким
LiveKit grant и не становится глобальным account permission.

Owner может revoke invite или member-а. Runtime-реализация обязана одновременно:

1. запретить новый snapshot и LiveKit token;
2. не обновлять уже выданный короткоживущий token;
3. удалить active participant через LiveKit Server API;
4. записать privacy-safe audit action с correlation ID.

Ответы `INVITE_UNAVAILABLE` и `MEMBERSHIP_REQUIRED` имеют 404 semantics и не
раскрывают, существовала ли room, какой invite был использован или кто owner.

## Public room data boundary

| State                                                     | Будущее хранилище | Не хранится                              |
| --------------------------------------------------------- | ----------------- | ---------------------------------------- |
| Account и verified email                                  | PostgreSQL        | Пароли, LiveKit secret                   |
| Public room owner/policy, invite hash, membership, revoke | PostgreSQL        | Movie bytes, название фильма, local path |
| Presence, active participant, chat                        | Redis TTL         | Persistent viewing history               |
| Media tracks                                              | LiveKit           | Original movie file в backend storage    |

`publicRoomId` — UUID persistent access record. Он намеренно отделён от
текущего 22-character `roomId`: future runtime безопасно связывает public
access record с эфемерной live room, не расширяя текущий LAN contract.

## Contract guard

`scripts/check-contracts.mjs` теперь проверяет следующие regression invariants:

- `wt_account` не заменяет `wt_session`;
- account/membership/invite endpoints имеют `implemented`, а Internet
  `livekit-token` остаётся `planned` до WT-655;
- invite path использует browser-only fragment;
- `inviteToken` write-only;
- API не содержит `inviteToken` в path или query parameter.

## Не входит в задачу

- login UI и экран Internet-комнаты;
- реальный public LiveKit, VM, DNS, TLS/TURN или production secrets;
- LiveKit token revoke runtime, member management UI и public room runtime;
- mobile playback, torrent/URL ingest, media storage, catalog или DRM bypass.

## Проверка

```bash
pnpm contracts:check
pnpm format:check
git diff --check
```

## Следующий шаг

WT-655 подключит к этой access boundary отдельный Internet room runtime:
public LiveKit, TLS/WSS/TURN, short-lived media token, active participant
disconnect после revoke и понятную диагностику сети. До готового staging gate
Internet mode не открывается пользователям.
