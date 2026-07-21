# WT-651 — Native media compatibility POC

## Цель

Проверить, может ли desktop host расширить личный сценарий «посмотреть свой
фильм вдвоём» за пределы browser-native MP4/M4V/WebM, не передавая исходный
файл на backend и не обещая поддержку «любого видео» до фактов.

## Вывод архитектурного исследования

В desktop LAN runtime не следует добавлять LiveKit Ingress как способ открыть
локальный MKV. Self-hosted Ingress — отдельный GStreamer service, которому
нужен Redis и заметная CPU-память; его URL input принимает только HTTP URL.
Это противоречит текущему installer-контракту: один local LiveKit node без
Docker и Redis.

Кандидат для следующего этапа — **локальная нормализация у host-а**:

```text
local MKV / HEVC / DTS file
  -> bundled native converter creates temporary H.264/AAC MP4 copy locally
  -> current Electron HTMLVideoElement + captureStream()
  -> existing LiveKit LAN room
```

Гость, backend и интернет по-прежнему не получают movie bytes. Цена — время,
CPU и свободное место на диске host-а. DRM, защищённые сервисы и неизвестные
или повреждённые файлы остаются вне поддержки.

## POC harness

`scripts/native-media-poc.mjs` не является частью desktop app и ничего не
пакует. Он запускается только с явно переданными `ffprobe`/`ffmpeg` и создаёт
локальный JSON report с inventory и измеренным wall-clock временем:

```sh
node scripts/native-media-poc.mjs \
  --ffprobe /path/to/ffprobe \
  --input /path/to/owned-sample.mkv

node scripts/native-media-poc.mjs \
  --ffprobe /path/to/ffprobe \
  --ffmpeg /path/to/ffmpeg \
  --input /path/to/owned-sample.mkv \
  --transcode \
  --output /private/tmp/spectemus-normalized.mp4
```

Текущий `poc-libx264-aac` намеренно предназначен только для измерений. Он
требует FFmpeg с `libx264`, который часто является GPL-сборкой, и поэтому не
может попасть в продуктовый installer без отдельного решения о лицензии.

## Матрица реального прогона

Не коммитить фильмы или любые пользовательские media bytes в Git. Для каждого
законно доступного локального sample фиксировать только report и агрегаты:

| Input         | Обязательное измерение     | Условие GO                                   |
| ------------- | -------------------------- | -------------------------------------------- |
| MP4 H.264/AAC | baseline без normalizing   | Текущий direct path не регрессирует          |
| MKV H.264/AAC | container-only normalizing | Output проходит existing file diagnostics    |
| MKV HEVC/AAC  | video transcode            | H.264/AAC output + publish/guest audio/video |
| MKV H.264/DTS | audio transcode            | AAC output + guest audio                     |
| HEVC MP4      | video transcode            | Не зависит от host browser HEVC decode       |

Для каждого успешного sample измерять: duration, source/output bytes,
wall-clock, realtime factor, средний/пиковый CPU, peak RSS, свободное место,
first frame после publish и 10-минутный host/guest smoke. Три класса машин:
Apple Silicon Mac, Intel Windows и минимально допустимый старый host.

## Release и licensing gate

- Не распространять произвольный FFmpeg binary. FFmpeg по умолчанию LGPL, но
  optional GPL/non-free parts меняют условия; release build, configure line,
  исходники и notices должны быть проверены до доставки пользователю.
- Не использовать `libx264` POC profile как installer profile. Следующий этап
  обязан отдельно сравнить platform hardware encoders и LGPL-compliant
  delivery, включая fallback/отказ при их отсутствии.
- Temp output хранить только в app data host-а, показывать требуемое место,
  давать cancel и auto-cleanup после комнаты. Никакой auto-upload, torrent,
  content catalog или обход DRM не добавляется.

## Решение после POC

GO для product implementation возможен только если common samples проходят
existing H.264/AAC diagnostics, CPU/диск укладываются в выбранный hardware
baseline, а packaging и licensing review одобрены. Иначе продукт честно
остаётся на direct MP4/M4V/WebM path, а unsupported file получает понятную
диагностику.

## Первое техническое evidence

На Apple Silicon Mac 2026-07-21 выполнены две синтетические локальные
трёхсекундные пробы (`640×360`, AAC): MKV H.264/AAC и MKV HEVC/AAC. Harness
нормализовал оба в MP4 H.264/AAC; wall-clock составил `0.152 s` и `0.149 s`
соответственно. Это подтверждает только корректность local-only inventory и
baseline command на малом synthetic input — не качество, не поддержку DTS и
не обещание скорости для настоящих фильмов.

Использованный Homebrew FFmpeg 8.1.2 собран с `--enable-gpl`, `libx264` и
`libx265`. Именно поэтому POC profile остаётся исследовательским и не может
перейти в installer без другого release profile и отдельного licensing review.

## Источники

- [LiveKit Ingress overview](https://docs.livekit.io/home/ingress/overview/) —
  URL input работает с HTTP media, включая MKV, но это отдельный service.
- [LiveKit self-hosted Ingress](https://docs.livekit.io/transport/self-hosting/ingress/)
  — GStreamer, Redis и resource requirements self-hosted ingress.
- [FFmpeg legal considerations](https://ffmpeg.org/legal.html) — LGPL/GPL
  boundary и требования к распространению FFmpeg.
