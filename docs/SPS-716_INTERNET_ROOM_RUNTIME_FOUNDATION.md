# SPS-716 — фундамент отдельного Internet room runtime

## Статус

Закрытый архитектурный срез. Internet mode остаётся недоступным для гостей.
Публичный просмотр, LiveKit token, SMTP, PostgreSQL и настоящие домены в этот
тикет не входят.

## Аудит основы WT-654

До этой ветки в `main` уже было:

- `/api/v2` для email challenge, account, public room, invite, revoke и
  redemption. Всё это включается только при `PUBLIC_ACCESS_ENABLED=true`.
- По умолчанию флаг выключен. Security chain не разрешает v2 routes, а beans
  public access не создаются. LAN desktop стартует без PostgreSQL и SMTP.
- Неполная public-access конфигурация задумана как остановка запуска, но
  проверка в compact constructor сейчас читает поле до присваивания. Этот
  дефект вынесен в отдельный тикет SPS-717 и в эту ветку не входит.
- `POST /api/v2/public-rooms/{publicRoomId}/livekit-token` в контракте остаётся
  `planned`. Контроллера и выдачи token нет.
- Revoke membership меняет access record и не отключает участника LiveKit.
- Invite URL по контракту — `/join#invite=<token>`. Во frontend этого маршрута
  не было: адрес попадал на страницу 404.
- LAN-создание остаётся `POST /api/v1/rooms` с прежним телом
  `{ hostDisplayName }`. Internet mode в этот запрос не добавляется.
- Страница LAN-приглашения `/rooms/{roomId}` уже скрывает форму создания до
  входа. Это другой маршрут и другой credential, чем Internet invite.

## Декомпозиция следующих задач

SPS-716 закрывает только границу режимов. Дальше каждая цель — отдельная ветка:

| Следующая задача             | Результат                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| Короткоживущий LiveKit token | Token только для активного member Internet room. LAN `/api/v1/.../livekit-token` не меняется |
| Membership и пределы         | Expired, revoked и exhausted invite, а также лимиты комнаты проверяются до media access      |
| Запрет нового token          | После revoke новый token не выдаётся                                                         |
| Отключение участника         | Уже подключённый participant удаляется через LiveKit Server API                              |
| Публичная media-конфигурация | WSS и TURN описываются отдельной конфигурацией, без настоящих credentials в git              |
| Диагностика сети             | Понятная ошибка для сложной сети и TURN fallback                                             |
| Privacy-safe telemetry       | В labels нет email, invite token и room ID                                                   |
| Staging без секретов         | Связка deployment остаётся на WT-680 и не получает выдуманные VM, DNS или пароли             |
| Release candidate            | Один интегрированный прогон: VM/DNS/HTTPS/WSS/TURN и физическая Mac ↔ Windows matrix         |

Номера этих веток назначаются при открытии, чтобы отдельный дефект installer
не занял место внутри Internet-серии.

## Что сделано

- Контракт `POST /api/v1/rooms` и `CreateRoomRequest` не изменились: в запросе
  по-прежнему только `hostDisplayName`.
- Флаг `VITE_INTERNET_ROOM_RUNTIME_ENABLED` по умолчанию выключен. В этом
  состоянии форма host-а остаётся прежней.
- При включённом флаге host видит выбор «В одной сети» / «Из разных городов».
  Второй вариант показывает отказ на экране и не отправляет сетевой запрос ни
  в `/api/v1`, ни в `/api/v2`.
- Будущий рабочий Internet flow должен идти через отдельную `/api/v2`
  поверхность. Этот тикет её не открывает.
- Маршрут `/join` показывает гостю, что просмотр из другого города закрыт.
  На странице нет формы создания, выбора файла, публикации и перемотки. Raw
  invite token из fragment не рисуется и не отправляется на сервер.
- `POST /api/v2/public-rooms/{id}/livekit-token` остаётся `planned`.

Пользовательское сообщение: «Просмотр из другого города сейчас закрыт.
Локальная комната вместо него не создаётся.» В нём нет stack trace, JDBC,
SMTP, пути к файлу и invite token.

## Откат

Вернуть `VITE_INTERNET_ROOM_RUNTIME_ENABLED=false`. Полный откат тикета
возвращает `/join` на страницу 404 и убирает выбор режима с главного экрана.
`/api/v1` при этом не меняется.

## Вне тикета

Не входят LiveKit token, revoke disconnect, TURN, telemetry, staging secrets,
включение `PUBLIC_ACCESS_ENABLED`, исправление проверки public-access
конфигурации и физическая matrix. Исправление `PublicAccessProperties` —
отдельный тикет SPS-717.

### Отдельный подтверждённый follow-up

Это не часть SPS-716 и не должно попасть в его diff.

Desktop installer run
[41436224900](https://github.com/Delakroa/spectemus-simul/actions/runs/41436224900)
собран из `2c38db55912b4535d3ebd14c70693869eca0bd35`. macOS arm64 и macOS x64
завершились успешно. Windows NSIS завершился ошибкой на шаге «Собрать LGPL
FFmpeg media sidecar». Последняя содержательная строка шага:

`Не найден Windows runtime или его лицензия: /mingw64/share/licenses/gcc-libs/COPYING3`

Исправление packaging остаётся отдельной веткой.

## Проверки

`pnpm check` завершился успешно.

- frontend: 155 тестов в 31 файле
- desktop: 58 тестов
- backend: 129 тестов
- media poc: 13 тестов
- LAN scripts: 36, media poc scripts: 4, staging preflight: 8

Проверен сценарий: при выборе закрытого Internet mode экран показывает отказ,
а `POST /api/v1/rooms` и `/api/v2` не вызываются. `CreateRoomRequest` содержит
только `hostDisplayName`.
