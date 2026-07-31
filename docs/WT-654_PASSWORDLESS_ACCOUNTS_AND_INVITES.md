# WT-654 — Passwordless accounts and invites

## Цель

Добавить изолированную server-side границу для будущих Internet-комнат:
passwordless account, одноразовое подтверждение email, постоянное membership
и отзывные приглашения. Это **не** открывает текущую LAN-комнату в интернет и
не добавляет передачу фильма в application backend.

## Граница задачи

- Новый API живёт только под `/api/v2`; `/api/v1`, `wt_session` и LAN desktop
  не меняются.
- Internet API выключен по умолчанию через `PUBLIC_ACCESS_ENABLED=false`.
  В таком состоянии его routes не разрешены security chain.
- При явном включении нужны отдельный PostgreSQL URL, учётные данные SMTP,
  `PUBLIC_ACCESS_IDENTITY_PEPPER` и secure cookie. Неполная конфигурация не
  должна запустить Internet mode.
- PostgreSQL получает только минимальные access records: fingerprint email,
  hash session/code/invite credentials, room policy, membership и безопасный
  audit. Movie bytes, имя файла и local path в схеме отсутствуют.
- Raw invite token имеет 32 random bytes и остаётся только в первом `no-store`
  response как `/join#invite=…`; в PostgreSQL хранится лишь hash. Raw
  одноразовый email code не логируется и не попадает в API response.
- `Idempotency-Key` постоянен в PostgreSQL на 24 часа. Одинаковый запрос
  создания комнаты или redemption вернёт исходный result, другой payload даст
  `IDEMPOTENCY_CONFLICT`. Для invite нельзя безопасно повторно отдать raw token,
  поэтому повтор получает `IDEMPOTENCY_REPLAY_UNAVAILABLE` и создаёт новое
  приглашение с новым key.

## Критерии готовности

1. `POST /api/v2/auth/email-challenges` всегда отвечает `202` для
   валидного email, не раскрывая наличие account.
2. Успешный одноразовый code создаёт или восстанавливает account и выдаёт
   отдельную `wt_account` HttpOnly/Secure/SameSite cookie.
3. Только account member видит public room; invite можно отозвать, а revoked
   или expired token не возвращает membership.
4. Public access выключен по умолчанию, а LAN desktop продолжает стартовать
   без PostgreSQL и SMTP.
5. `/livekit-token` остаётся planned до WT-655: membership уже создан, но
   Internet media runtime и публичный deployment в эту задачу не входят.

## Внешние prerequisites

Для реального включения понадобятся не выдуманные тестовые данные, а:

1. PostgreSQL для staging и согласованный migration/backup path;
2. SMTP provider и подтверждённый sender address;
3. HTTPS app origin. VM, DNS, TLS/WSS/TURN относятся к WT-655, а не к этой
   задаче.

## Миграция и откат

`backend/src/main/resources/db/migration/V1__public_access.sql` создаёт только
новые таблицы `wt_public_*`; существующие LAN Redis-ключи и `/api/v1` не
меняются. Перед первым staging run Flyway применяет migration вместе с запуском
явно включённого public access. Быстрый operational rollback — вернуть
`PUBLIC_ACCESS_ENABLED=false`: v2 routes исчезнут, а access records останутся
для расследования и последующего контролируемого повторного включения. Удалять
таблицы как часть rollback нельзя: это уничтожит audit и active revoke state.

## Проверка

Проверяются account/invite unit и controller tests, contract guard, полный
`pnpm check:ci` и GitHub CI. Реальная доставка письма и сессия из разных
городов проверяются только на следующем staging gate.

## Следующий шаг

WT-655 подключит к уже существующему membership отдельный Internet room
runtime: TLS/TURN, short-lived LiveKit token, revoke/disconnect и диагностику
сети. До этого desktop остаётся LAN-first preview.
