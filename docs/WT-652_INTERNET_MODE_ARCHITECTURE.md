# WT-652 — Internet mode architecture

> **Историческое решение, приостановлено SPS-736.** Ниже описан центральный
> Internet-контур с публичной VM, account и LiveKit. Он остаётся в git для
> аудита уже выполненной работы, но не является текущим планом продукта.
> Актуальная цель — комната на компьютере host-а; см.
> [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md) и
> [SPS-736_HOST_OWNED_INTERNET_ROADMAP.md](SPS-736_HOST_OWNED_INTERNET_ROADMAP.md).

## Статус

Завершено как архитектурное решение и план безопасного запуска. В этой задаче
нет публичного deploy, аккаунтов или изменения текущего LAN-контракта: для них
нужны отдельные ветки, домен, VM, DNS, секреты и измерения стоимости.

## Цель

Добавить после стабилизации LAN понятный режим «посмотреть вместе из разных
городов». Он должен сохранить главную ценность продукта — private review
небольшой группы, где host выбирает локальный файл и управляет просмотром, —
но не превращать текущий invite URL в публичный bearer-доступ и не обещать
безлимитный видео-хостинг.

## Принятые решения

### 1. LAN и Internet — два режима, а не один небезопасный переключатель

| Свойство                 | LAN mode сегодня                  | Internet mode после отдельных тикетов            |
| ------------------------ | --------------------------------- | ------------------------------------------------ |
| Где работает host        | Desktop в домашней/офисной сети   | Desktop host с доступом к публичному media plane |
| Access                   | Текущая room session и LAN invite | Аккаунт + отзываемый invite + membership         |
| Signaling                | Локальный gateway/LiveKit         | `https://app.<domain>` и `wss://rtc.<domain>`    |
| Проходимость NAT         | Зависит от локальной сети         | ICE/UDP → TURN/UDP → ICE/TCP → TURN/TLS fallback |
| Источник фильма          | Только локальный файл host-а      | Только локальный файл host-а                     |
| Хранение фильма сервисом | Нет                               | Нет                                              |

LAN mode остаётся бесплатным и простым: он не требует аккаунта, публичной VM
или email. Internet mode появляется в UI как отдельный, явно более
ответственный выбор с объяснением сети и приватности.

### 2. Не обещать «файл никуда не уходит» в интернет-режиме

Исходный movie file не загружается в backend и не сохраняется сервисом. Но
host захватывает локальное воспроизведение и посылает зашифрованный WebRTC
media stream через LiveKit; при сложной сети он может пройти через TURN relay.
Поэтому корректная формулировка: «Мы не загружаем и не храним файл фильма;
для совместного просмотра его медиапоток передаётся участникам через
защищённую инфраструктуру». Нельзя использовать копирайтинг, который создаёт
ложное впечатление, что байты media никогда не покидают устройство host-а.

### 3. Первый публичный контур — одна управляемая VM, не Kubernetes

Первый этап обслуживает маленькие private rooms, а не массовую аудиторию.
Нужны один регион, один публичный IP, резервные копии и простая диагностика.
Kubernetes, multi-region и autoscaling добавляются только после доказанной
нагрузки: LiveKit требует прямого доступа к WebRTC port range, а распределённый
кластер потребует Redis и аккуратного draining активных комнат.

```text
Desktop host / guests
        │ HTTPS, WSS, WebRTC
        ▼
 app.<domain> ── Caddy ── gateway + Spring Boot ── Redis (TTL/realtime)
        │                                      │
        │                                      └── PostgreSQL (accounts/invites)
        ▼
 rtc.<domain> ── Caddy ── LiveKit single node ── TURN/TLS: turn.<domain>
        │
        └── UDP media / TCP fallback
```

Gateway/backend и Redis не открываются в интернет напрямую. Caddy принимает
HTTPS/WSS для app и rtc routes; LiveKit сам обслуживает media-plane порты.
Отдельные `app`, `rtc` и `turn` hostnames делают TLS, CSP, firewall и incident
diagnosis проверяемыми по отдельности.

### 4. Public room требует account и membership

Текущий route `/rooms/{roomId}` полезен в LAN, но недостаточен для интернета:
room ID нельзя считать proof of access. Public room имеет owner-а, состояние
membership и invite record в PostgreSQL.

Первый account flow — passwordless email challenge:

1. Пользователь вводит email; backend выдаёт одноразовый challenge с коротким
   TTL и rate limit по IP/email.
2. Пользователь вводит код или открывает magic link; храним только hash
   challenge, а не исходный код.
3. После успешной проверки создаются account и HttpOnly/Secure session.
4. Owner создаёт invite с expiry, max redemptions и возможностью revoke.
5. Invite URL содержит только случайный opaque token. В БД хранится его hash;
   URL не содержит LiveKit JWT, host secret, email или имя файла.
6. Invite сначала приводит к account check, затем создаёт membership. Только
   membership даёт room snapshot и краткоживущий LiveKit token.

По умолчанию invite не даёт право создавать комнаты, менять роли или видеть
другие комнаты owner-а. Роли: `OWNER`, `HOST`, `GUEST`, `OPERATOR`. Operator
не получает media credentials и не видит содержимое фильма/чата по умолчанию.

### 5. Revocation работает на control plane и не полагается на URL secrecy

При revoke invite или member:

- новая выдача room snapshot и LiveKit token сразу запрещается;
- короткоживущий token не обновляется;
- backend отправляет LiveKit Server API команду удалить participant из room;
- audit event хранит только actor, action, target type и correlation ID.

Токен уже в браузере не становится магически недействительным сам по себе.
Поэтому TTL должен быть коротким, а disconnect — обязательной частью revoke
flow. Это также причина не строить public access на постоянном invite URL.

## Публичная инфраструктура и firewall

Минимальный production perimeter:

- trusted CA certificates для `app`, `rtc` и `turn` доменов;
- `443/TCP` для app HTTPS, LiveKit signaling и TURN/TLS согласно выбранной
  топологии;
- `80/TCP` только для issuance/redirect TLS;
- `3478/UDP` для TURN/UDP, `7881/TCP` для ICE/TCP и настраиваемый
  WebRTC UDP range (`50000-60000` в базовой LiveKit конфигурации);
- отдельный firewall/ACL: SSH доступен только администратору, Redis,
  PostgreSQL, backend management и Prometheus не имеют public ingress;
- `SESSION_COOKIE_SECURE=true`, HSTS, narrowed CSP `connect-src` и trusted
  forwarded headers только от локального proxy.

До реального deploy нельзя фиксировать cloud provider, регион, IP, порты,
цены или домены в репозитории. Их выбирают по доступности для целевой группы,
правовым требованиям и результатам TURN/QoS evidence, а секреты хранятся вне
Git.

## Состояние, приватность и миграция контрактов

| Сущность                                   | Хранилище                        | Retention                          | Чего в ней нет                |
| ------------------------------------------ | -------------------------------- | ---------------------------------- | ----------------------------- |
| Live room, presence, ephemeral chat        | Redis TTL                        | Время комнаты                      | Movie bytes, local path       |
| Account, verified email, session reference | PostgreSQL                       | До удаления аккаунта               | Пароль, LiveKit secret        |
| Public room owner/policy                   | PostgreSQL                       | До expiry/deletion policy          | Media metadata и bytes        |
| Invite token hash/redemption/revoke state  | PostgreSQL                       | До expiry + операционный retention | Исходный token                |
| Telemetry/feedback aggregates              | Существующий privacy-safe контур | По retention policy                | Email/room ID в metric labels |

Current `/api/v1` LAN rooms не меняются задним числом. Internet-mode endpoints
и schema появляются в новой versioned contract surface только после отдельного
design-review. Ожидаемые группы ресурсов: auth challenge/verify, public rooms,
memberships, invites и account sessions. Новый public API обязан иметь runtime
schema validation, idempotency там, где создаёт состояние, correlation ID в
ошибках и contract tests на expired/revoked/over-limit paths.

## Abuse, безопасность и стоимость

Public mode нельзя открыть без следующих controls:

- rate limits по IP, account и invite для auth, room creation, invite
  redemption, LiveKit token и feedback;
- email provider с проверенным sender domain; нет паролей, нет recovery flow;
- CSRF-safe mutation design, Secure/HttpOnly cookies и отсутствие credentials
  в URL/localStorage;
- лимиты account: число активных комнат, участников, invite redemption и
  максимальная длительность public room;
- alert на необычный TURN relay, egress, auth failure, new-account/invite
  bursts и room creation; метрики не используют email или room ID как label;
- deletion/export policy для account data, privacy notice и операционный
  runbook incident/revoke.

Монетизация не должна опережать evidence. На раннем этапе разумная граница:
LAN режим всегда остаётся основным бесплатным личным сценарием; публичный
режим доступен как ограниченная invite-only beta. Только после измерения
network egress, TURN share, support load и successful-session rate можно
проверить маленький paid tier за расширенные public-room limits. Продажа
фильмов, torrent-функции, catalog, загрузка оригинальных файлов и обход DRM
не входят в продукт.

## Порядок реализации

| Этап | Отдельный тикет                          | Результат и gate                                                                                    |
| ---- | ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 0    | WT-610 evidence run                      | Реальная VM/DNS/TLS/TURN, `beta:smoke`, host+guest и UDP-blocked evidence; без accounts             |
| 1    | WT-653 public access contracts           | Утверждённые модели account/invite/membership, migration и privacy text; без production credentials |
| 2    | WT-654 passwordless accounts and invites | Email challenge, revoke, membership, rate limits, audit и contract/E2E tests                        |
| 3    | WT-655 internet room runtime             | Отдельный UI choice, public LiveKit config, token/revoke path, TURN-aware diagnostics и telemetry   |
| 4    | WT-656 private internet alpha            | Малый allowlist, manual support, cost/QoS/reliability report и GO/ADJUST/STOP decision              |

Этап 0 должен завершиться раньше этапов 2–4. Этап 1 можно подготовить в
репозитории параллельно, но он не даёт права раскрывать сервис публике.

## Критерии GO для private internet alpha

Перед первым внешним invite одновременно выполнены:

- trusted HTTPS/WSS и TURN/TLS доказаны реальной сессией из двух разных сетей;
- host + 1 guest и host + 3 guest прошли video/audio/voice/chat/reconnect;
- UDP-blocked сеть корректно получает fallback или понятное объяснение;
- expired, revoked и exhausted invite не дают access/token и отключают active
  participant;
- secrets/ports/Prometheus/Redis/PostgreSQL прошли perimeter review;
- известны p50/p95 first-frame, publish failure, reconnect, TURN usage и
  примерная стоимость одной успешной room-minute;
- privacy text, account deletion и incident/revoke runbook опубликованы;
- нет обещания mobile/DRM/«любой файл»/неограниченного просмотра.

Если хотя бы один пункт не пройден, остаёмся на LAN/closed-beta и не называем
Internet mode релизом.

## Не входит в задачу

- public deployment, покупка домена или VM;
- имплементация email login, PostgreSQL migrations и новых REST endpoints;
- native transcoding, torrents, URL-media ingest, catalog, recording или DRM
  обход;
- mobile video playback, массовый multi-region или high-availability SLA.

## Проверка

Это documentation-only решение. Проверены:

```bash
pnpm format:check
git diff --check
```

Источники решения:

- [LiveKit deployment](https://docs.livekit.io/transport/self-hosting/deployment/) — trusted TLS, TURN и production configuration.
- [LiveKit ports and firewall](https://docs.livekit.io/transport/self-hosting/ports-firewall/) — WebRTC/TURN port perimeter.
- [LiveKit distributed multi-region](https://docs.livekit.io/transport/self-hosting/distributed/) — Redis и draining для multi-node.
- [LiveKit VM deployment](https://docs.livekit.io/transport/self-hosting/vm/) — VM/Caddy/TURN baseline.
