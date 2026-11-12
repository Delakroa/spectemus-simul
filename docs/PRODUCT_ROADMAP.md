# Дорожная карта Spectemus Simul

## Зачем существует этот документ

Это единый порядок развития продукта. Новая продуктовая ветка начинается только
с задачи из этой карты или после её явного обновления. Так мы не добавляем
случайные функции и не ломаем главную идею: небольшой приватный просмотр своего
фильма вместе с близкими людьми.

## Неподвижные принципы

- **Главный сценарий:** host выбирает фильм на своём компьютере, создаёт
  приватную комнату и отправляет гостю понятное приглашение.
- **Фильм не становится загрузкой в сервис:** приложение не хранит оригинал,
  путь к нему или каталог фильмов. В Internet mode между участниками идёт
  защищённый медиапоток, а не облачная копия файла.
- **LAN и Internet — разные режимы:** LAN остаётся простым и бесплатным,
  Internet mode добавляет account, отзывное приглашение, HTTPS и TURN. Новый
  режим не ослабляет безопасность существующего LAN-приглашения.
- **Не строим:** torrent/URL ingest, обход DRM, видеокаталог, запись просмотра,
  массовые комнаты и монетизацию до подтверждённой ценности и стоимости.
- **Сначала надёжность, затем расширение:** у каждой фазы есть проверяемый
  выход; «код написан» не равен «функция готова для людей».

## Текущее состояние

LAN desktop preview умеет создать комнату, поделиться ссылкой или QR-кодом,
синхронно передавать видео и звук, вести чат и восстанавливать сессию. WT-682
добавил локальную подготовку распространённых контейнеров во временный
H.264/AAC MP4. SPS-711–SPS-715 уже в коде: Windows runtime FFmpeg, конечная
позиция ползунка, прямой звук host-а и адаптивная подготовка MKV. Это
реализация и автоматические тесты. Физический прогон Mac ↔ Windows ещё не
подтвердил все форматы и платформы, поэтому до финального evidence такое
подтверждение обещать нельзя.

Физическая матрица больше не блокирует следующие задачи в репозитории. Она
входит в финальный release-candidate gate вместе с проверкой Internet mode.
Ручной installer smoke после каждого PR тоже больше не требуется.

Internet mode остаётся выключенным. WT-654 держит account, membership и
отзывное приглашение за `PUBLIC_ACCESS_ENABLED=false`. SPS-716 отделяет выбор
LAN и Internet, но не открывает публичный просмотр и не подменяет отказ
Internet-комнаты локальной комнатой. SPS-717 восстанавливает fail-fast:
неполная public-access конфигурация останавливает запуск и не включает
Internet mode. SPS-718 делает OSV Security Scan устойчивым на PR и оставляет
full scan fail-closed. SPS-719 закрывает найденные уязвимости зависимостей
без suppressions, чтобы полный OSV scan снова был зелёным. SPS-720 добавляет
`POST /api/v2/public-rooms/{id}/livekit-token` за отдельным
`PUBLIC_LIVEKIT_ENABLED=false`: короткоживущий JWT только для active member,
без fallback на LAN LiveKit credentials. SPS-721 после revoke member вызывает
LiveKit `RemoveParticipant` по opaque identity; membership revoke в БД остаётся
источником истины. Self-hosted LiveKit не отзывает уже выданный JWT — только
отключает participant и блокирует новый token. SPS-722 добавляет guest entry
`/join#invite=<token>` → email challenge → redemption → страница Internet-комнаты
за тем же `VITE_INTERNET_ROOM_RUNTIME_ENABLED=false`; media/LiveKit и host flow
ещё не подключаются. SPS-723 добавляет browser host entry: email account,
public room и hash-only invite с обязательным public HTTPS origin. SPS-724
даёт Electron host одноразовую device-authorization привязку к public
account без ослабления Strict cookie и без credential в URL. SPS-725
подключает browser guest и desktop host к public LiveKit после mint token.
SPS-726 даёт desktop HOST публикацию локального фильма в public LiveKit
через переиспользованный LAN media pipeline. SPS-727 подключает guest
remote playback `movie-video` / `movie-audio`. SPS-728 добавляет Internet
playback sync: host управляет исходным видео, гость видит состояние без
перемотки WebRTC-потока. SPS-729 добавляет только repo-side opt-in staging
для public runtime: отдельные настройки PostgreSQL/SMTP/LiveKit, HTTPS/WSS
origin и закрытый LAN API. Реальный TURN и межсетевой просмотр ещё не проверены.

## Порядок задач

| Фаза | Состояние                                     | Результат                                                                                                                         | Незавершённый gate                                                                                                     |
| ---- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 0    | Код готов: WT-682, WT-684–WT-689, SPS-711–715 | Локальная подготовка и исправления desktop/LAN. Физически форматы и платформы ещё не подтверждены                                 | Mac ↔ Windows matrix перенесена в финальный release-candidate gate                                                     |
| 1    | Код готов, feature выключена: WT-654          | Изолированный `/api/v2`: account, email challenge, membership, отзыв invite и audit                                               | PostgreSQL, SMTP и sender domain; revoked invite не даёт access                                                        |
| 2    | Код готов, feature выключена: SPS-716/720–734 | Явный выбор LAN/Internet. Public account, room/invite, media, playback sync и opt-in staging application layer изолированы от LAN | Реальные VM/DNS/TLS/WSS/TURN и диагностика. Публичный доступ по умолчанию выключен; JWT живёт до TTL на self-hosted LK |
| 3    | Запланировано: private alpha                  | Ограниченная invite-only проверка «host дома → гость в другом городе»                                                             | Сессии из разных сетей, включая сложную сеть; измерены QoS, TURN usage, стоимость и support load                       |
| 4    | Запланировано: closed beta → release          | Понятная установка, операционный контур и честный UX для малых private rooms                                                      | Успешность сессий, privacy/deletion policy, incident/revoke runbook, физическая matrix и проверенная экономика         |

## Что делаем следующим

SPS-716 фиксирует границу режимов, SPS-720 выдаёт короткоживущий public LiveKit
token, SPS-721 отключает participant после revoke member, SPS-722 проводит гостя
от invite fragment до membership без media, SPS-723 создаёт public room и invite
из browser host flow, SPS-724 безопасно привязывает Electron host к public
account через device-authorization exchange без credential в URL, SPS-725
подключает Internet-комнату к public LiveKit, SPS-726 публикует локальный
фильм desktop HOST в public LiveKit, SPS-727 даёт guest remote playback
movie tracks, SPS-728 синхронизирует play/pause/seek через playback-state
без перемотки гостевого WebRTC. SPS-729 готовит отдельный opt-in staging
application layer, но не создаёт внешние ресурсы и не доказывает работу TURN.
SPS-730 показывает состояние интернет-соединения и даёт локально скопировать
безопасный отчёт без адресов и токенов. SPS-731 добавляет закрытую по
умолчанию серверную основу privacy-safe telemetry: только membership-gated
enum-события и агрегированные счётчики. SPS-732 подключает browser и desktop
к этому контракту только после согласия пользователя в Internet-комнате;
отправка по умолчанию выключена. SPS-733 отключает журналы запросов на
публичном gateway и фиксирует проверку логов остальных сервисов как условие
открытия стенда. SPS-734 готовит отдельный opt-in desktop installer с единым
публичным HTTPS origin для интерфейса и Electron main; обычный LAN installer
остаётся закрытым для Internet mode. Следующий gate —
реальные VM/DNS/TLS/WSS/TURN, проверка логов на VM и межсетевой прогон. Ни
один из этих тикетов не делает LAN-комнату публичной.

Публичный доступ и заявление о готовности Internet mode невозможны, пока не
пройдена финальная проверка VM, DNS, HTTPS, WSS и TURN. До неё же остаётся
физическая matrix фазы 0.

Внешние ресурсы по-прежнему нельзя выдумывать в коде:

1. PostgreSQL для persistent accounts/invites.
2. Почтовый provider и подтверждённый sender domain для одноразовых кодов.
3. VM, три DNS-имени (`app`, `rtc`, `turn`) и доступ администратора.

Без этого гость из другого города не откроет просмотр: нужен публичный control
plane для account/invite и доступный с обеих сторон WebRTC/TURN relay.

## Рабочее правило для каждой задачи

1. Перед веткой фиксируем одну цель, границу и критерии готовности в документе
   SPS-задачи.
2. Меняем минимально необходимый слой и не смешиваем LAN и public mode.
3. Запускаем локальные проверки и обычный PR CI. Ручной installer smoke и
   физический Mac ↔ Windows прогон выполняются один раз на интегрированном
   release candidate, а не после каждого PR.
4. После merge обновляем этот документ: статус, фактический результат и
   следующий gate.
5. Только затем создаём следующую ветку.

Если новая идея не помогает главному сценарию, не проходит privacy boundary или
не имеет понятного gate, она попадает в backlog, а не в текущую разработку.
