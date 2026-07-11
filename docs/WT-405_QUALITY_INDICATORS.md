# WT-405 Quality indicators

## Статус

Завершено.

## Цель

Показать host и guest локальные индикаторы качества LiveKit-соединения без отправки медиа-метрик в backend.

## Реализовано

- Добавлен frontend monitor `quality-indicators`, который слушает `connectionQualityChanged` и собирает агрегированные RTC stats с local/remote LiveKit tracks.
- В `useRoomSession` добавлено состояние `qualityIndicators`; monitor запускается после LiveKit connect и очищается при disconnect/reconnect cleanup.
- В комнате появилась карточка `Качество`:
  - статус: проверка, стабильно, нестабильно, плохая связь, потеряно, переподключение;
  - upload/download bitrate;
  - RTT, jitter, packet loss;
  - разрешение и FPS, если доступны;
  - короткое предупреждение при poor/lost/high loss/high jitter/high RTT.
- Показатели privacy-safe: в UI и state попадают только агрегаты, без participant identity, track id, IP, device id или media content.

## Пороговые предупреждения

- `poor/lost` из LiveKit connection quality сразу переводит карточку в плохое/потерянное состояние.
- Packet loss от `1%` даёт warning, от `5%` даёт poor.
- Jitter от `40 ms` или RTT от `200 ms` даёт warning.
- Jitter от `90 ms` или RTT от `450 ms` даёт poor.

## Проверки

- `./node_modules/.bin/vitest run src/features/rooms/quality-indicators.test.ts src/pages/HomePage.test.tsx src/features/rooms/use-room-session-voice.test.tsx src/features/rooms/use-room-session-host-controls.test.tsx src/features/rooms/use-room-session-chat.test.tsx`
- `./node_modules/.bin/tsc -b --pretty false`
- `./node_modules/.bin/eslint src/features/rooms/quality-indicators.ts src/features/rooms/quality-indicators.test.ts src/features/rooms/use-room-session.ts src/pages/HomePage.tsx src/pages/HomePage.test.tsx --max-warnings 0`

## Ограничения

- Метрики обновляются локально в браузере и не сохраняются как telemetry event.
- Download RTT обычно недоступен через receiver stats; RTT показывается по upload sender stats.
- First frame, TURN ratio и долгосрочная аналитика остаются отдельной telemetry/stabilization задачей.
