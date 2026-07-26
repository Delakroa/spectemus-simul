# WT-668 — trusted client IP для LAN gateway

Gateway удаляет клиентский `X-Forwarded-For` и передаёт backend только адрес
фактического TCP-сокета. Это сохраняет реальный per-client rate limit в LAN и
не даёт клиенту подделать свой IP. Для HTTP upstream добавлен 15-секундный
таймаут; если backend оборвал уже начатый ответ, gateway закрывает соединение,
а не дописывает JSON в чужое тело.

Проверка: `pnpm --dir desktop test`.
