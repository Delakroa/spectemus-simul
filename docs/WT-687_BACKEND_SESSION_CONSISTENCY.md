# WT-687 — согласованность backend room session и trusted proxy boundary

## Цель

Сделать существующий LAN/Compose backend предсказуемым при конкурентных
WebSocket-подключениях и не позволить клиенту выбрать себе ключ rate limit через
подставной заголовок. Desktop-профиль должен восстановить фактический статус
комнаты после краткого отключения host-а.

## Что сделано

- Nginx всегда заменяет входящий `X-Forwarded-For` на адрес своего клиента
  перед вызовом backend. Пользовательский заголовок больше не влияет на ключ
  rate limit для `POST /api/*` и actuator proxy.
- Снятие WebSocket-сессии теперь удаляет `sessionsByRoom` внутри
  `ConcurrentHashMap.computeIfPresent`. Новое подключение, появившееся рядом с
  закрытием старого, не может потерять mapping комнаты и перестать получать
  chat/presence/lifecycle events.
- In-memory store desktop-профиля сохраняет `statusBeforeHostDisconnect` при
  join и leave guest-а. После reconnect host-а комната возвращается в реальный
  статус, например `PLAYING`, а не ошибочно в `CREATED`.

## Проверки

```bash
node --test scripts/nginx-proxy-headers.test.mjs
./gradlew :backend:test --no-daemon \
  --tests '*InMemoryRoomStoreTest' \
  --tests '*RoomWebSocketHandlerTest' \
  --tests '*RateLimitInterceptorTest'
```

Тесты фиксируют proxy boundary, сохранение room mapping при закрытии одной из
нескольких WebSocket-сессий и восстановление `PLAYING` после join/leave guest-а
в host reconnect grace period.

## Граница

Это не отзыв уже выданного LiveKit token: этот архитектурный шаг потребуется
до публичных отзывных приглашений в Internet mode. Тикет также не меняет
desktop gateway media proxy — его timeout, client abort и WebSocket failure
semantics идут отдельной задачей.
