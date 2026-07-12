# WT-505 Security hardening

## Статус

Завершено.

## Цель

Провести аудит модели угроз перед бетой, закрыть реальные пробелы (security-заголовки / CSP на публичном периметре, secret-scanning в CI) и зафиксировать уже действующие защитные меры.

## Модель угроз (кратко)

Активы: доступ к приватной комнате, session-credential гостя/хоста, host secret, LiveKit-токены, локальный медиапоток хоста. Рассматриваемые угрозы: перебор/энумерация комнат, brute-force session/host secret, XSS, clickjacking, CSRF, злоупотребление WebSocket, утечка секретов в репозиторий, вредоносные зависимости.

## Уже действующие меры (аудит)

- **Энумерация комнат** — roomId 22 симв. base64url (~132 бит энтропии, WT-201); `join` и `livekit-token` возвращают одинаковый `ROOM_UNAVAILABLE` для несуществующей и недоступной комнаты (нет оракула).
- **Session / host secret** — 43-симв. (~256 бит) случайные credential и host secret; в хранилище только SHA-256; host secret не попадает в guest URL. Cookie `wt_session`: `HttpOnly`, `SameSite=Strict`, `Secure` (конфигурируемо).
- **AuthZ** — Spring Security deny-by-default (`anyRequest().denyAll()`), явный `permitAll` на список room-эндпоинтов, `STATELESS`.
- **CSRF** — фильтр отключён осознанно: аутентификация state-changing POST идёт по cookie `wt_session` c `SameSite=Strict`, что блокирует межсайтовые запросы с cookie; host-only действия дополнительно требуют `X-Host-Secret` в заголовке.
- **LiveKit token scope** — токен scoped на room+identity, разные grants HOST/GUEST, TTL, не выдаётся для закрытой комнаты и не-участника (WT-301; тесты `LiveKitTokenServiceTest`).
- **XSS** — React рендерит текст только текстовыми узлами (нет `dangerouslySetInnerHTML`); чат отклоняет управляющие символы и ограничивает длину.
- **WebSocket abuse** — авторизация на handshake, лимит кадра 16 KiB, chat rate limit, закрытие на некорректных данных, проверка совпадения `participantId` с сессией, потокобезопасная сериализованная отправка (WT-501).
- **Секреты в репозитории** — только в `.env` / secret storage (CONVENTIONS.md), в git — только placeholder-ы и примеры; `.gitignore`.
- **Зависимости** — `dependency-review` + OSV-scanner (существующий `security-scan.yml`).

## Что добавлено в WT-505

- **Security-заголовки на gateway** (`infra/nginx/security-headers.conf`, подключены в `default.conf` на уровне server и в location статики): `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (микрофон — self, остальное запрещено). Заголовки отдаются на HTML, статике и проксируемом `/api`. CSP рассчитан на Vite-сборку: `script-src 'self'` (в бандле нет inline-скриптов), `style-src 'self' 'unsafe-inline'` (инлайновые style-атрибуты React), `connect-src 'self' ws: wss:` (room WebSocket + LiveKit signaling), `blob:` для локального превью/медиа, `frame-ancestors 'none'` (clickjacking). `frontend/Dockerfile` копирует сниппет в образ.
- **Secret scanning в CI** — job `secret-scan` в `security-scan.yml` (gitleaks v8.30.1 через Docker, без org-license) + `.gitleaks.toml` с allowlist фикстур/примеров/build-артефактов/placeholder-ов. Прогнан локально: `no leaks found`.

## CORS

Архитектура same-origin: gateway отдаёт frontend и проксирует `/api` и WebSocket на том же origin, поэтому CORS не требуется и не сконфигурирован (кросс-оригин по умолчанию запрещён — безопасно). Если появится сторонний кросс-оригин клиент, CORS нужно включить узко и явно.

## Проверка

- Пересобран `gateway`; `curl -I` на `/`, статику и `/api` — все security-заголовки присутствуют.
- Приложение загружено в браузере: рендерится, `/api` работает (статус backend UP), в консоли нет CSP-нарушений и ошибок — CSP не ломает SPA.
- `gitleaks detect --no-git --config .gitleaks.toml` → `no leaks found` (exit 0).
- backend/frontend код не менялся — их тесты/гейт не затронуты.

## Известные ограничения / следующие шаги

- **HSTS** не выставляется: TLS терминируется на ingress/reverse-proxy в проде — `Strict-Transport-Security` следует добавить на TLS-слое при HTTPS-only деплое.
- **Per-endpoint REST rate limiting** (429) объявлен в контракте, но не реализован для create/join/leave/close/token; brute-force сейчас сдерживается энтропией ID. Полноценный распределённый лимитер (Redis) — отдельный шаг.
- **CSP `connect-src`** допускает `ws:`/`wss:` широко ради конфигурируемого хоста LiveKit — в фиксированном деплое сузить до конкретного origin.
- Полный threat-model review / pentest — активность перед GA, вне рамок WT-505.
