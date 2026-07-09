# WT-001 Media Capture LiveKit PoC

Этот package — P0 reference implementation внутри Watch Together monorepo. Product backend, product frontend, room lifecycle, chat, voice, Redis и PostgreSQL находятся вне этого PoC.

## 1. Назначение прототипа

Этот прототип проверяет только P0-сценарий Watch Together:

```text
локальный MP4 у host -> HTMLVideoElement -> captureStream()
-> публикация audio/video tracks в LiveKit -> guest browser
```

Прототип не создаёт продуктовые комнаты, аккаунты, чат, Spring Boot backend, Redis, PostgreSQL, transcoding или хранение видео. Локальный файл остаётся в браузере host и используется через `URL.createObjectURL()`.

## 2. Требования

- Node.js 20+.
- Docker Desktop или совместимый Docker Compose.
- Desktop Chrome или Edge.
- MP4 H.264/AVC, AAC, до 1080p для основного теста.

Firefox, Safari, mobile browsers, MKV, HEVC, DTS и DRM не входят в WT-001.

## 3. Как установить зависимости

```powershell
cd watch-together-media-capture-livekit/poc/media-capture-livekit
copy .env.example .env
pnpm install
```

Из корня репозитория `pnpm install` также устанавливает этот workspace package.

## 4. Как запустить всё одной командой

```powershell
cd watch-together-media-capture-livekit
pnpm dev:poc
```

Или из директории этого package:

```powershell
cd watch-together-media-capture-livekit/poc/media-capture-livekit
pnpm dev
```

Эта команда поднимает LiveKit через Docker Compose, token endpoint на `http://127.0.0.1:3001` и frontend на `http://127.0.0.1:5173`.

`Ctrl+C` останавливает token endpoint и frontend. LiveKit запускается в Docker в detached mode; чтобы остановить контейнер отдельно, используй:

```powershell
pnpm dev:down
```

## 5. Как запустить LiveKit отдельно

```powershell
cd watch-together-media-capture-livekit/poc/media-capture-livekit
docker compose up -d livekit
docker compose ps
```

Локальный LiveKit слушает `ws://127.0.0.1:17880`. Development-only API key и secret находятся только в `.env` и `livekit.yaml`; frontend их не читает. Эти значения предназначены только для локального PoC.

## 6. Как запустить token endpoint

В отдельном терминале:

```powershell
cd watch-together-media-capture-livekit/poc/media-capture-livekit
pnpm dev:token
```

Endpoint:

```text
GET http://127.0.0.1:3001/token?room=wt-poc-room&identity=host-1&role=host
```

Он принимает только room, identity и role. Видео, путь к файлу и бинарные данные не принимаются.

## 7. Как запустить frontend

В отдельном терминале:

```powershell
cd watch-together-media-capture-livekit/poc/media-capture-livekit
pnpm dev:frontend
```

Vite будет доступен на `http://127.0.0.1:5173`.

## 8. Как открыть host

Открой:

```text
http://127.0.0.1:5173/?mode=host&room=wt-poc-room
```

Порядок проверки:

1. Нажми `Connect`.
2. Выбери MP4 через file picker.
3. Убедись, что local preview играет со звуком.
4. Нажми `Publish captured tracks`.
5. Используй `Play`, `Pause` и seek slider или controls видео.
6. Для смены файла выбери новый MP4; старый object URL будет освобождён, а старая публикация остановлена.

## 9. Как открыть guest

Открой второе окно Chrome/Edge:

```text
http://127.0.0.1:5173/?mode=guest&room=wt-poc-room
```

Нажми `Connect`. Guest должен увидеть connection state, subscription state, remote video и audio state. Если браузер заблокирует autoplay audio, нажми `Enable sound`.

Guest использует нативные video controls браузера, как host: volume, mute и fullscreen работают штатно. Product-state комнаты всё равно принадлежит host; локальные pause/seek на guest не отправляют команды host.

## 10. Какой тестовый файл использовать

Основной файл:

```text
Container: MP4
Video codec: H.264 / AVC
Audio codec: AAC
Resolution: 720p или 1080p
```

Дополнительно проверь MP4 без audio track. Это не считается ошибкой: host должен опубликовать video track и явно показать `No audio track captured`.

## 11. Известные ограничения

- `HTMLMediaElement.captureStream()` поддерживается не во всех браузерах; WT-001 ориентирован на desktop Chrome/Edge.
- Guest audio может требовать пользовательского действия из-за autoplay policy.
- Pause у host теперь дополнительно передаётся как WT-004 playback-state событие, но backend-owned room state ещё не реализован.
- Seek у host виден guest как скачок кадров в live stream; WT-004 обновляет host playback state, но точная VOD-синхронизация по timestamp пока не реализована.
- Без TURN/TLS этот compose предназначен для локального теста на одной машине или в простой LAN.
- LiveKit image tag закреплён для воспроизводимого PoC, но перед beta версию нужно сверить с production-рекомендациями.

## 12. Диагностика

- `captureStream is not supported`: открой PoC в desktop Chrome или Edge.
- `Token endpoint is unavailable`: проверь `pnpm dev:token` и `VITE_TOKEN_ENDPOINT`.
- `LiveKit connection failed`: проверь `docker compose up -d livekit`, `docker compose ps`, порт `17880` и совпадение key/secret в `.env` и `livekit.yaml`.
- `v1 RTC path not found` в browser console: LiveKit server слишком старый для установленного `livekit-client`; пересоздай контейнер через `docker compose pull livekit` и `docker compose up -d --force-recreate livekit`.
- Guest видит video, но не слышит audio: нажми `Enable sound`, проверь, что исходный файл содержит AAC audio track и что host preview не muted.
- Повторный выбор файла не обновляет stream: нажми `Stop publication`, затем выбери файл снова; если проблема повторяется, перезагрузи host страницу и зафиксируй browser/version.

## 13. Где смотреть логи

Browser logs:

```text
Chrome/Edge DevTools -> Console
```

Самые полезные строки: `v1 RTC path not found`, `WebSocket connection failed`, `publishTrack`, `trackSubscribed`, `disconnected`, `reconnecting`.

LiveKit server logs:

```powershell
cd watch-together-media-capture-livekit/poc/media-capture-livekit
pnpm logs:livekit
```

Для быстрой проверки версии сервера:

```powershell
docker compose exec livekit /livekit-server --version
```

## 14. Как убедиться, что файл не загружается на backend

1. Открой DevTools -> Network на host странице.
2. Включи фильтр `Fetch/XHR`.
3. Выбери локальный MP4 и нажми `Publish captured tracks`.
4. Должен быть только запрос к `/token` с query params room/identity/role.
5. Не должно быть `POST`, `PUT`, `multipart/form-data`, больших request payload или запроса с именем файла.
6. В фильтре `WS` будет подключение к LiveKit; это WebRTC signaling/media-plane, не application backend upload.

## WT-002 / WT-003 / WT-004

- WT-002 матрица совместимости: [../../docs/WT-002_COMPATIBILITY_MATRIX.md](../../docs/WT-002_COMPATIBILITY_MATRIX.md)
- WT-003 качество и задержка: [../../docs/WT-003_QUALITY_LATENCY.md](../../docs/WT-003_QUALITY_LATENCY.md)
- WT-004 media pipeline ADR: [../../docs/WT-004_MEDIA_PIPELINE_ADR.md](../../docs/WT-004_MEDIA_PIPELINE_ADR.md)
- WT-004 product-state sync: [../../docs/WT-004_PRODUCT_STATE.md](../../docs/WT-004_PRODUCT_STATE.md)

Текущий вывод P0: `GO` для перехода к P1 foundation на базе Chrome/Edge + MP4 H.264/AAC + LiveKit. Это ещё не production quality/SLO.

Подтверждено:

- Chrome host -> Chrome guest: 27 минут playback без отвалов.
- Edge playback smoke: работает.
- Video + audio через LiveKit: работает.
- Файл не загружается на application backend.
- Guest использует native browser video controls, включая volume и fullscreen.
- Guest UI после подписки показывает метрики WT-003: time to first frame, dropped frames, video receiver bitrate/loss/jitter и audio receiver bitrate/loss/jitter.

Для проверки сохранения разрешения сравнивай три значения:

1. `Source resolution` у host — фактическое разрешение выбранного файла после загрузки metadata.
2. `Capture resolution` у host — что отдал `captureStream()` в `MediaStreamTrack`.
3. `Video stats` у guest — какое разрешение реально декодирует guest после WebRTC.

В текущем baseline источник и capture были `1920x1080`, а guest декодировал `1280x720`. Это зафиксированное ограничение PoC; 1:1 resolution tuning вынесен отдельно и не блокирует WT-004.

Перед продуктовым обещанием качества/масштаба нужно снять метрики для 2 guests и 3 guests, а также отдельно проверить controlled network scenarios, если они входят в MVP.

## WT-004

WT-004 фиксирует media pipeline decision в ADR и добавляет первый product-state прототип.

Host теперь отправляет состояние просмотра через LiveKit data channel topic `wt.playback-state.v1`.

Guest получает и показывает `Host playback`, а также применяет host `playing/paused/ended` к своему remote video. Это первый product-state слой: host уже является авторитетным для play/pause, но точная VOD-синхронизация seek по timestamp пока не реализована, потому что guest получает live WebRTC stream, а не локальный файл.

Для ручной проверки:

1. Host выбирает MP4, подключается и публикует tracks.
2. Guest подключается к той же room.
3. Host нажимает `Pause` / `Play` / делает seek.
4. Guest должен обновлять `Host playback`; play/pause должны применяться к remote video.
5. После guest reload/reconnect новое состояние должно приехать через heartbeat host.

## Автоматические проверки

```powershell
cd watch-together-media-capture-livekit
pnpm test
pnpm build
```

Или из директории этого package:

```powershell
cd watch-together-media-capture-livekit/poc/media-capture-livekit
pnpm test
pnpm build
```

Эти тесты покрывают только логику без реального browser media pipeline: MIME support, error normalization, object URL cleanup, media track cleanup, отсутствие audio track, отсутствие `captureStream()` и кодирование/валидацию WT-004 playback-state messages.
