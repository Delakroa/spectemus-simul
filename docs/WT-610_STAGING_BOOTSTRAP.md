# WT-610 Staging bootstrap

## Статус

Готово для repo-side bootstrap. Добавлен воспроизводимый application layer для
реального TLS/TURN staging. Внешний deploy и evidence-run ещё не выполнены:
они требуют VM, доменов, DNS, секретов и живых участников.

## Зачем это нужно

Ранее `infra/compose.yaml` был сознательно local-only: он включает собственные
Redis и LiveKit, а ports привязаны к loopback. Его нельзя просто открыть в
интернет и назвать staging: не будет корректного TLS/TURN perimeter, а новый
локальный Redis конфликтует с production LiveKit Redis.

WT-610 фиксирует безопасную границу:

- официальный LiveKit generator отвечает за Caddy, certificate issuance,
  embedded TURN/TLS, ICE ports и Redis foundation;
- `infra/staging/compose.yaml` отвечает только за Watch Together backend и
  gateway, которые слушают loopback;
- backend использует Redis database `1`, LiveKit — database `0`;
- отдельные `app`, `rtc` и `turn` hostnames делают TLS, WSS и TURN/TLS
  наблюдаемыми и проверяемыми;
- gateway получает доверенный `X-Forwarded-Proto=https` только от локального
  Caddy route, а local Compose явно задаёт `http`.

## Что добавлено

- `infra/staging/compose.yaml` — application compose без второго LiveKit/Redis;
- `infra/staging/.env.example` — только placeholders, без секретов;
- `infra/staging/caddy-app-route.fragment.yaml` — fragment для generated Caddy
  route приложения;
- `infra/staging/README.md` — последовательность DNS, firewall, secrets,
  deployment, smoke и rollback;
- nginx template для явного trusted forwarded protocol в staging.

## Область и ограничения

- Нет cloud provider, domain, реального certificate или production secret в
  репозитории.
- Нет автоматического public deploy: это потребовало бы чужого аккаунта,
  платежей и доступа к VM.
- Не добавляются accounts, media formats, mobile playback, torrents или
  streaming catalog — feature freeze до evidence остаётся в силе.
- `beta:evidence:preflight` и `beta:smoke` подтверждают ready pipeline, но
  не заменяют Chrome/Edge × host+1/host+3 и TURN-only evidence.

## Проверка

- `docker compose --env-file <env> -f infra/staging/compose.yaml config`;
- `pnpm infra:config` для local stack;
- `pnpm infra:check` для room/WebSocket regression;
- `pnpm test:e2e` для сценариев комнаты через видимую рабочую область, а не
  свёрнутую диагностику;
- `pnpm check`.

## Следующий шаг

Дать staging VM с доменом и DNS либо доступ к облачному аккаунту. После этого
можно выполнить bootstrap без изменения архитектуры: развернуть generated
LiveKit foundation, добавить app Caddy route, поднять staging compose и
запустить публичные preflight/smoke. Только затем начинается реальная матрица
WT-603 и решение GO/ADJUST/STOP.
