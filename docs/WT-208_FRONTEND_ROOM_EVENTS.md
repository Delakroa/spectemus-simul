# WT-208 Frontend room events

## Статус

Завершено.

## Цель

Подключить React frontend к реализованному backend room lifecycle: пользователь должен создавать комнату, входить по ссылке или ID, видеть участников и получать изменения комнаты через backend-owned WebSocket events.

## Поведение

- Главная страница получила product UI для создания комнаты host-ом через `POST /api/v1/rooms`.
- Гость может войти через форму с `roomId`, вставить полную invite-ссылку или открыть invite route `/rooms/{roomId}` и присоединиться через `POST /api/v1/rooms/{roomId}/join`.
- После успешного create/join frontend открывает WebSocket `/api/v1/rooms/{roomId}/events`.
- Первичный `room.snapshot` и последующие события применяются к локальному состоянию через отдельный reducer.
- Frontend отправляет `participant.heartbeat` каждые 15 секунд, пока WebSocket открыт.
- UI показывает room status, room version, invite link, текущего participant, список участников, online/offline state и журнал последних событий.
- Host видит команду закрытия комнаты через `POST /api/v1/rooms/{roomId}/close`.
- Guest видит команду выхода через `POST /api/v1/rooms/{roomId}/leave`.

## Runtime validation

Внешние REST/WebSocket payload проходят Zod validation до попадания в UI state:

- `CreateRoomResponse`;
- `JoinRoomResponse`;
- `RoomSnapshot`;
- `participant.joined`;
- `participant.left`;
- `participant.online`;
- `participant.offline`;
- `room.closed`.

Неизвестные WebSocket events с валидным envelope не ломают UI и попадают в журнал как неизвестные события. Это сохраняет forward compatibility для следующих product events.

## Frontend state

Frontend считает backend source of truth:

- `room.snapshot` полностью заменяет текущий snapshot;
- `participant.joined` добавляет или обновляет участника;
- `participant.left` удаляет участника из списка;
- `participant.online` и `participant.offline` обновляют presence;
- `room.closed` переводит комнату в финальное состояние и помечает участников offline;
- stale events с более старым `roomVersion` игнорируются.

## Проверка

```bash
pnpm --filter @watch-together/frontend typecheck
pnpm --filter @watch-together/frontend test
pnpm check
pnpm infra:check
pnpm security:audit
```

Финальная проверка:

- frontend typecheck прошёл;
- frontend tests: 6 файлов, 14 тестов;
- полная проверка `pnpm check` прошла;
- Docker Compose stack пересобран, все сервисы healthy;
- `infra:check`: frontend, reverse proxy, REST room lifecycle и WebSocket room events прошли через `http://127.0.0.1:8088`;
- `pnpm security:audit`: production-уязвимости не обнаружены.

## Известные ограничения

- WT-208 не добавляет выбор видео, LiveKit product tokens и playback controls.
- Автоматическое восстановление комнаты после refresh без повторного join/create не входит в WT-208, потому что `GET /api/v1/rooms/{roomId}` ещё остаётся planned contract.
- UI пока не делает browser notification/toast слой; журнал событий отображается внутри экрана комнаты.
