# WT-607 Media QoS and traffic cost benchmark

## Статус

Готово (kit). В repo добавлен runbook и скрипт расчёта `scripts/media-qos-cost-summary.mjs`. Сами замеры выполняются вручную на целевом beta/staging окружении, потому что зависят от LiveKit deployment, TURN/TCP fallback, реального host uplink и выбранного MP4.

## Цель

Закрыть риск из WT-602/WT-507: перед расширением beta нужно понимать, выдерживает ли media path комнату `host + 1/2/3 guest`, сколько стоит LiveKit/TURN egress и при каких цифрах нельзя поднимать лимит выше `4/4`.

## Scope

- Фиксированный MP4: H.264/AAC, 720p или 1080p, 15-30 минут, один и тот же файл для всех прогонов.
- Матрица: Chrome и Edge, `host + 1`, `host + 2`, `host + 3`, normal network и отдельный UDP-blocked/TURN-only path.
- Сбор: LiveKit ingress/egress bitrate, TURN egress subset, first-frame p95, RTT p95, jitter p95, packet loss p95, poor/lost quality seconds, reconnects, CPU/RAM host и LiveKit.
- Расчёт: measured GB, GB/hour, estimated `$ / hour`, PASS/WARN/FAIL findings.

## Команды

Печать JSON-шаблона:

```bash
pnpm beta:qos:template
```

Расчёт summary после заполнения JSON:

```bash
pnpm beta:qos:summary docs/evidence/WT-607_<date>.json
```

Без `pnpm` можно напрямую:

```bash
node scripts/media-qos-cost-summary.mjs --template
node scripts/media-qos-cost-summary.mjs docs/evidence/WT-607_<date>.json
```

## Runbook

1. Задеплоить целевой build и записать commit/base URL.
2. Выбрать один fixture MP4 и не менять его между сессиями.
3. Проверить перед стартом:
   - `pnpm beta:evidence:preflight`;
   - `pnpm beta:smoke`;
   - Prometheus/LiveKit admin доступны только оператору;
   - известна цена egress/TURN (`liveKitEgressUsdPerGb`, `turnEgressUsdPerGb`).
4. Для каждой строки матрицы открыть host и нужное число guest в реальных браузерах/машинах.
5. Host публикует fixture, guest смотрят 15-30 минут. Не переключать файл и не менять качество вручную.
6. Снять client-side quality indicators у host/guest и LiveKit/WebRTC stats:
   - avg ingress Mbps host -> LiveKit;
   - avg egress Mbps LiveKit -> guests;
   - avg TURN egress Mbps, если path идёт через relay;
   - first-frame p95;
   - RTT/jitter/packet loss p95;
   - poor/lost quality seconds;
   - reconnect count.
7. Снять resource sampling:
   - host CPU/RAM p95;
   - LiveKit CPU/RAM p95;
   - при Docker: `docker stats`;
   - при staging: cloud/VM metrics за окно сессии.
8. Заполнить JSON по шаблону и выполнить `pnpm beta:qos:summary`.
9. Вставить markdown summary в evidence report и вынести FAIL/WARN в blocker/non-blocker issues.

## Input format

Минимальный session объект:

```json
{
  "id": "chrome-host-3-normal",
  "browser": "Chrome",
  "networkProfile": "normal",
  "mediaPath": "direct-udp",
  "guestCount": 3,
  "durationMinutes": 30,
  "liveKit": {
    "ingressAvgMbps": 3.2,
    "egressAvgMbps": 9.6,
    "turnEgressAvgMbps": 0
  },
  "quality": {
    "firstFrameP95Ms": 1800,
    "rttP95Ms": 90,
    "jitterP95Ms": 18,
    "packetLossP95Percent": 0.4,
    "poorQualitySeconds": 12,
    "lostQualitySeconds": 0,
    "reconnects": 0
  },
  "resources": {
    "hostCpuP95Percent": 55,
    "hostMemoryMbP95": 1200,
    "liveKitCpuP95Percent": 35,
    "liveKitMemoryMbP95": 900
  }
}
```

`egressAvgMbps` — суммарный outbound из LiveKit ко всем guest. Для `host + 3` это примерно `guest downlink bitrate * 3`, если все получают один и тот же stream. Скрипт считает decimal GB:

```text
GB = Mbps * duration_seconds / 8 / 1000
```

## Default thresholds

| Метрика            | FAIL если выше |
| ------------------ | -------------- |
| first-frame p95    | 5000 ms        |
| RTT p95            | 250 ms         |
| jitter p95         | 60 ms          |
| packet loss p95    | 3%             |
| poor/lost ratio    | 10% сессии     |
| lost quality       | 0 seconds      |
| reconnects         | 0              |
| room egress        | 6 GB/hour      |
| room media cost    | $1/hour        |
| host CPU p95       | 85%            |
| host memory p95    | 4096 MB        |
| LiveKit CPU p95    | 75%            |
| LiveKit memory p95 | 2048 MB        |

Thresholds можно переопределить в JSON, если beta deployment имеет другой cost envelope.

## Scaling decision

Оставляем MVP limit `4/4` и не расширяем beta, если:

- `host + 3` normal path даёт FAIL по first-frame, loss, poor/lost ratio или reconnects;
- UDP-blocked/TURN-only path не воспроизводится или не имеет понятного verdict;
- estimated room media cost при `host + 3` выше согласованного лимита;
- host или LiveKit CPU/RAM p95 показывает узкое место на одной комнате;
- WARN/FAIL findings не перенесены в WT-603 evidence report и issue list.

Можно обсуждать расширение beta только если:

- Chrome и Edge на normal path проходят `host + 3`;
- TURN-only path задокументирован как supported или честно вынесен в limitation;
- стоимость `host + 3` понятна в `$ / hour` и не ломает beta budget;
- качество деградирует через UI indicators, а не через падение room lifecycle.

## Реализация

- `scripts/media-qos-cost-summary.mjs` — читает WT-607 JSON и печатает markdown summary с PASS/WARN/FAIL findings.
- `package.json` — команды `beta:qos:template` и `beta:qos:summary`.
- `docs/WT-607_MEDIA_QOS_COST_BENCHMARK.md` — runbook, input format и scaling gates.

## Проверка

```bash
node scripts/media-qos-cost-summary.mjs --template
node scripts/media-qos-cost-summary.mjs <filled-report.json>
node_modules/.bin/prettier --check scripts/media-qos-cost-summary.mjs docs/WT-607_MEDIA_QOS_COST_BENCHMARK.md
```

## Известные ограничения

- Скрипт не собирает WebRTC stats сам: браузерные/LiveKit метрики снимает оператор, потому что source зависит от deployment и LiveKit edition.
- Cost estimate считает только media egress/TURN. REST, WebSocket, Redis и frontend hosting остаются negligible для текущего MVP.
- Значения thresholds — beta gates, не публичный SLA.
