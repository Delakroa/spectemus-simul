# WT-504 Network resilience

## Статус

Завершено для browser offline/reconnect automation и runbook matrix.

## Цель

Проверить, что пользовательская сессия переживает кратковременную потерю сети без перезагрузки страницы, а оставшиеся degraded-network сценарии имеют воспроизводимую матрицу проверки перед capacity/beta.

## Что автоматизировано

- Playwright multi-context сценарий `network-resilience.spec.ts`:
  - host создаёт комнату;
  - guest входит отдельным browser context;
  - guest отправляет chat до разрыва;
  - guest context переводится в offline;
  - frontend показывает room WebSocket `reconnecting`;
  - сеть возвращается;
  - room WebSocket возвращается в `live`;
  - guest снова отправляет chat, host его получает.

## Команды

Перед запуском поднять полный локальный стек:

```bash
pnpm infra:up
pnpm test:e2e:network
```

Полный E2E-набор остаётся отдельной командой:

```bash
pnpm test:e2e
```

## Manual network matrix

Эти сценарии требуют OS/browser/network tooling и не включаются в `check:ci`:

| Сценарий                   | Способ проверки                                                       | Ожидаемый результат                                                                | Статус             |
| -------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------ |
| Latency 200-400 ms         | Network Link Conditioner, Chrome DevTools Protocol или proxy shaping  | Room WS остаётся connected/reconnecting без terminal error; chat восстанавливается | Manual             |
| Packet loss 1-5%           | OS/proxy shaping                                                      | Quality indicators уходят в warning/poor, session остаётся управляемой             | Manual             |
| Low bandwidth uplink       | OS/proxy shaping                                                      | UI показывает деградацию качества; host может остановить/перепубликовать           | Manual             |
| Browser offline            | Playwright `browserContext.setOffline`                                | WS reconnect, свежий snapshot, chat после восстановления                           | Automated          |
| UDP blocked / TCP fallback | Firewall блокирует UDP media range `50000-50100`, TCP `7881` доступен | LiveKit либо работает через TCP fallback, либо ограничение документировано         | Manual             |
| TURN-only                  | Public TURN/TLS deployment                                            | Media path работает без прямого UDP                                                | Out of local scope |
| VPN / unstable network     | Реальный VPN или сетевой proxy                                        | Нет бесконечного loader; ошибки recoverable                                        | Manual             |

## Реализация

- `e2e/tests/support/room-flow.ts` — общие helper-ы create/join/chat и проверки room WebSocket статуса.
- `e2e/tests/multi-user.spec.ts` — переведён на shared helper-ы.
- `e2e/tests/network-resilience.spec.ts` — automated offline/reconnect E2E.
- `e2e/package.json` и root `package.json` — добавлен `test:e2e:network`.

## Проверка

```bash
pnpm --filter @watch-together/frontend lint
pnpm --filter @watch-together/frontend typecheck
pnpm --filter @watch-together/frontend test
pnpm contracts:check
pnpm format:check
```

Локально в этой задаче проверено:

- frontend lint/typecheck/unit tests прошли;
- contracts check прошёл;
- backend tests прошли;
- Prettier и `git diff --check` прошли;
- `pnpm test:e2e:network` в текущей shell-сессии не запускался: `pnpm`, `corepack` и локальный Playwright binary недоступны в PATH. Сценарий добавлен для запуска в окружении, где установлен E2E workspace.

## Известные ограничения

- Automated WT-504 не эмулирует WebRTC media packet loss. Browser-level offline проверяет room WebSocket recovery и пользовательскую управляемость сессии.
- UDP blocked, TURN-only и VPN требуют отдельной инфраструктуры и ручного evidence перед WT-508 beta deployment.
- `test:e2e:network` зависит от поднятого stack на `http://127.0.0.1:8088` и установленного Chromium (`pnpm --filter @watch-together/e2e run e2e:install`).
