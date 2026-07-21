# WT-647 — Desktop host architecture

## Статус

Решение принято. Реализация разбита на следующие тикеты.

## Цель

Привести S² к нормальному пользовательскому сценарию: человек скачивает
инсталлятор, открывает приложение, создаёт комнату и отправляет ссылку. На
компьютере host-а не нужны Terminal, Node.js, pnpm и Docker Desktop.

Первый desktop-релиз остаётся **LAN-first**: host и гости находятся в одной
домашней сети. Гость может открыть обычную invite-ссылку в desktop Chrome или
Edge; отдельная guest-версия приложения появится позже и не блокирует простой
сценарий «у host-а установлено приложение, гостю достаточно ссылки».

## Принятое решение

Первый desktop host будет строиться на **Electron**, а не на Tauri.

Причина практическая: текущий media path host-а использует
`HTMLMediaElement.captureStream()` и уже проверен в desktop Chromium
(Chrome/Edge). Electron даёт тот же Chromium-контур внутри установщика; macOS
WebView в Tauri стал бы отдельной непроверенной media-платформой. Это не
обещает поддержку новых кодеков, но позволяет не сломать уже работающие
MP4/M4V и WebM при переходе к приложению.

Electron включает нужный runtime, поэтому пользователь не устанавливает
Node.js. Java runtime, Spring Boot backend и LiveKit Server поставляются
приложением как versioned sidecar-ресурсы. Nginx gateway и Docker Compose в
desktop mode не используются.

Официальный LiveKit release публикует Windows и Linux архивы, но не macOS
архив. Поэтому WT-649 допускает Homebrew LiveKit только для developer proof на
Mac; до WT-650 macOS sidecar обязан собираться и подписываться в release CI, а
не устанавливаться пользователем через Terminal.

## Целевая схема первого desktop-релиза

```text
S² Desktop Host (Electron)
│
├─ Chromium window
│  └─ существующий React UI + current MP4/M4V/WebM capture path
│
├─ local supervisor (Electron main process)
│  ├─ запускает Spring Boot на 127.0.0.1
│  ├─ запускает LiveKit Server одним локальным узлом
│  ├─ генерирует per-installation secrets и LAN config
│  └─ корректно останавливает дочерние процессы
│
└─ lightweight Node HTTP gateway
   ├─ раздаёт собранный React UI на LAN IP:8088
   ├─ проксирует /api и room WebSocket в backend
   └─ даёт гостям тот же same-origin URL, что и host-у

Гости в LAN
└─ Chrome / Edge → http://<host-LAN-IP>:8088/rooms/<invite>
```

LiveKit в single-node режиме не имеет внешних зависимостей; Redis нужен для
distributed multi-node режима. Поэтому desktop host не должен упаковывать
Docker, PostgreSQL или Redis только ради текущей LAN-комнаты.

### Что меняется в product backend

Текущий backend использует Redis для room TTL, presence, rate limit и feedback
triage. Для desktop LAN profile нужен отдельный in-process store с теми же
контрактами, TTL и синхронизацией внутри одного процесса. Он не заменяет
production Redis profile и не меняет Docker-разработку.

PostgreSQL в текущем Compose не используется product-кодом и не входит в
desktop runtime. Feedback в первом offline desktop-релизе остаётся локальным
и необязательным; отправка наружу появится только вместе с будущим публичным
сервисом и согласием пользователя.

### Безопасность и UX

- При первом запуске генерируются уникальные LiveKit key/secret и session
  secret; они хранятся только в данных приложения и не попадают в UI, ссылки
  или логи.
- Backend остаётся на loopback; наружу в LAN слушают только gateway и LiveKit
  необходимые для комнаты порты.
- Приложение показывает выбранный private IPv4 и просит явно выбрать сеть,
  если их несколько; не делает port forwarding и не использует публичный IP.
- Windows firewall permission запрашивается узко и только для Private profile,
  как в текущем LAN bootstrap.
- Остановка приложения предлагает завершить активную комнату и корректно
  завершает sidecars; crash recovery отображает понятное действие «Запустить
  host заново».

## Что это пока не решает

### Форматы

Electron сохраняет текущую browser-native границу: MP4/M4V (H.264 + AAC) и
WebM после runtime preflight. Сам installer не делает MKV, HEVC, DTS или любой
случайный файл воспроизводимым.

Для MKV и расширенных контейнеров нужен отдельный native-media этап. LiveKit
Ingress может принимать HTTP media sources, включая Matroska, но в
self-hosted режиме это отдельный GStreamer/Redis service с транскодированием и
заметной нагрузкой. Поэтому сначала нужен малый эксперимент с реальными
файлами и измерением CPU/качества; только затем решается, упаковывать ли
native pipeline и какие кодеки можно обещать пользователю.

### Друзья из другого города

Desktop host не отменяет NAT. Для надёжного просмотра между городами нужны
публичный HTTPS endpoint, TURN и стабильный signalling/service layer. Это
следующий, отдельный режим продукта; он не подменяется router port forwarding
или обещанием, что LAN-invite заработает через интернет.

## Последовательность реализации

| Тикет  | Результат                                                                                                   | Блокирует                                                  |
| ------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| WT-648 | Desktop backend profile: in-process room/presence/rate-limit store с contract и concurrency tests           | Убирает Redis/PostgreSQL из user runtime                   |
| WT-649 | Electron host proof: supervisor, локальный LiveKit single-node, UI/gateway и явный start/stop status        | Проверяет запуск существующего product path без Docker     |
| WT-650 | Подписанные DMG/NSIS installers, first-run network/firewall UX и install/update smoke                       | Превращает proof в передачу обычному пользователю          |
| WT-651 | Native media compatibility POC: выбранные MP4/MKV samples, decode/transcode, CPU/quality и licensing review | Решение, какие дополнительные форматы реально поддерживать |
| WT-652 | Internet mode architecture: account, public URL, TLS/TURN, privacy/cost limits                              | Просмотр между городами                                    |

Каждый пункт — отдельная ветка и PR. Нельзя смешивать перенос local runtime с
codec pipeline или публичным сервисом: так остаётся понятно, что именно
изменилось и где искать проблему.

## Проверка решения

Перед началом WT-649 proof обязан пройти на macOS и Windows:

1. installer запускается на чистом компьютере без Node.js/pnpm/Docker;
2. host создаёт LAN room, а guest открывает invite в браузере;
3. MP4 H.264/AAC проходит current preflight, publish, play/pause/seek и
   reconnect;
4. закрытие окна не оставляет backend или LiveKit process в фоне;
5. host + 1/2/3 guest соответствует текущим capacity limits.

## Источники решения

- [LiveKit: single-node и Redis](https://docs.livekit.io/reference/internals/livekit-sfu/) — Redis требуется для distributed multi-node режима; single node не имеет внешних зависимостей.
- [LiveKit: запуск локального сервера](https://docs.livekit.io/transport/self-hosting/local/) — LiveKit Server может запускаться локально и принимать LAN-клиентов при bind `0.0.0.0`.
- [LiveKit Ingress](https://docs.livekit.io/home/ingress/overview/) — native ingress принимает Matroska, но self-hosted ingress остаётся отдельным транскодирующим сервисом.
- [Electron](https://www.electronjs.org/) — Chromium-based desktop shell для сохранения текущей browser media model.

## Следующий шаг

WT-648: вынести Redis-зависимые room stores за desktop profile без изменения
контрактов Docker/LAN development режима. Только после этого имеет смысл
собирать первый Electron host proof.
