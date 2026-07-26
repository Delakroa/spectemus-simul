# WT-503 Multi-user E2E

## Статус

В процессе. Harness и базовый multi-user сценарий готовы; прогон против стека и дополнительные сценарии — ниже.

## Цель

End-to-end проверка многопользовательского сценария: host + два гостя работают в комнате через реальный стек (backend + Redis + LiveKit + gateway). Уровень проверки — signaling / UI: room lifecycle, presence, chat, host controls, reconnect, voice denial. Реальные медиапиксели LiveKit не проверяются автоматически (см. ограничения).

## Решение по подходу

- **Playwright, multi-context.** Каждый участник — отдельный browser context (независимые session-cookie), все против поднятого стека на `http://127.0.0.1:8088`.
- **fake media.** Chromium запускается с `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`, `--autoplay-policy=no-user-gesture-required`, чтобы LiveKit устанавливал WebRTC без реальных устройств и жеста. Пиксельная проверка медиа не делается — она флэйкова в headless и остаётся ручной (как в PoC).
- **Отдельный `test:e2e`, вне `check:ci`.** Браузерный E2E зависит от поднятого стека и по своей природе тяжелее и потенциально флэйковее unit-тестов, поэтому НЕ включён в `pnpm check:ci` — чтобы не дестабилизировать основной CI-гейт (после недавней борьбы с флэйки backend-тестами это осознанное решение).

## Реализация

- `e2e/` — новый workspace-пакет `@spectemus-simul/e2e` (добавлен в `pnpm-workspace.yaml`).
- `e2e/playwright.config.ts` — chromium с fake-media флагами, `baseURL` (env `E2E_BASE_URL`, по умолчанию gateway 8088), serial / single-worker.
- `e2e/tests/multi-user.spec.ts` — базовый сценарий (см. ниже), селекторы по реальному DOM `HomePage` (aria-label «Имя host» / «Имя гостя» / «Invite-ссылка или ID комнаты» / «Сообщение в чат», кнопки «Создать» / «Войти» / «Отправить», `.room-copy-field code` для roomId, счётчик «3/4»).
- Корневой скрипт `pnpm test:e2e` (`--filter @spectemus-simul/e2e`), скрипт установки браузера `e2e:install`.

## Покрыто сейчас

- host создаёт комнату → два гостя входят по roomId → все три клиента сходятся на `3/4` участников (presence fan-out);
- сообщение гостя доходит до host и второго гостя (и эхом к отправителю); ответ host доходит до обоих гостей.

## Как запускать

```bash
pnpm install
pnpm --filter @spectemus-simul/e2e run e2e:install   # chromium, один раз
pnpm infra:up                                         # поднять стек (gateway на 8088)
pnpm test:e2e
```

## Важно перед коммитом

Добавлен новый workspace-пакет `e2e` с зависимостью `@playwright/test`, которой ещё нет в `pnpm-lock.yaml`. CI ставит зависимости через `pnpm install --frozen-lockfile`, поэтому **нужно один раз выполнить `pnpm install` и закоммитить обновлённый `pnpm-lock.yaml`** — иначе CI упадёт на шаге установки. Браузеры при этом НЕ скачиваются: pnpm блокирует postinstall-скрипты, кроме разрешённых в `onlyBuiltDependencies` (там только `esbuild`), а chromium ставится отдельной командой `e2e:install`.

## Известные ограничения / следующие шаги

- В текущем dev-окружении Playwright не прогонялся (нет установленного браузера / поднятого стека под рукой) — сценарий проверен по соответствию селекторов реальному DOM; фактический прогон нужно выполнить командами выше. E2E вне `check:ci`, поэтому его состояние не влияет на CI-гейт PR.
- Следующие спеки в этом же harness: host controls (play/pause через LiveKit data channel), reconnect (drop WebSocket через `context.setOffline` → авто-reconnect WT-406), voice denial (запрет доступа к микрофону → error-состояние).
- Реальная отдача/приём медиа LiveKit (видимое видео/звук) проверяется вручную по сценарию из `WT-004_PRODUCT_STATE.md`.
