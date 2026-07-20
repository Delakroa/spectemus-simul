# WT-644 — macOS Host launcher

## Статус

Завершено.

## Цель

Дать владельцу Mac такой же простой старт домашней комнаты, как уже есть на
Windows: открыть один файл из корня репозитория, дождаться готовности и сразу
перейти в браузер. При этом не выдавать LAN-режим за публичный хостинг и не
скрывать ошибки в окне, которое моментально закрывается.

## Реализация

- Добавлен исполняемый [`Start-Spectemus-Simul.command`](../Start-Spectemus-Simul.command).
  Двойной клик открывает его в Terminal и запускает общий безопасный путь
  `pnpm host:lan:start`.
- Перед стартом launcher проверяет `pnpm` и запущенный Docker Desktop. При
  ошибке объясняет причину и ждёт Enter, а не закрывает окно молча.
- После зелёного LAN doctor launcher читает только уже проверенный
  `LIVEKIT_NODE_IP` из `infra/lan.env` и открывает
  `http://<LAN-IP>:8088`.
- Общий `host:lan:start` остаётся единственным местом, которое выбирает private
  IPv4, настраивает `infra/lan.env`, поднимает Compose и проверяет gateway +
  LiveKit. Launcher не настраивает router, port forwarding, публичный IP или
  облачный сервер.
- В корневом README и LAN-инструкции теперь рядом указаны Windows `.cmd` и
  macOS `.command` варианты.

## Использование

На Mac с установленными Node.js/pnpm и Docker Desktop:

1. В Finder дважды нажмите `Start-Spectemus-Simul.command` в корне репозитория.
2. Если Docker Desktop ещё не запущен, launcher сам откроет его и ждёт
   готовности до двух минут.
3. После автоматического открытия страницы создайте комнату и отправьте гостю
   созданную invite-ссылку. Гость в той же домашней сети открывает её в
   desktop Chrome или Edge.

Если macOS впервые спрашивает разрешение на запуск, подтвердите открытие файла.
Это локальный shell launcher из самого репозитория, а не загружаемое приложение.

## Проверка

Автоматически:

```bash
zsh -n Start-Spectemus-Simul.command
pnpm format:lan
pnpm test:lan
```

`macos-launcher.test.mjs` проверяет interpreter, переход в корень проекта,
общий LAN flow, чтение `LIVEKIT_NODE_IP`, автоматическое открытие URL и
диагностику ошибок.

Фактически на macOS проверен общий путь `pnpm host:lan:start`: Compose поднял
gateway и LiveKit, а `pnpm infra:lan:doctor` подтвердил gateway, signalling,
TCP fallback и корректный LAN URL. UDP media range всё ещё подтверждается
реальным совместным просмотром между устройствами.

## Ограничения и следующий шаг

Это упрощённый запуск **из репозитория**. Node.js/pnpm и Docker Desktop пока
нужны на компьютере host-а, но с WT-645 Docker Desktop на Mac стартует
автоматически. Следующий продуктовый этап для людей без терминала и Docker —
отдельное desktop-приложение с включённым runtime и понятным install/update
flow; он требует отдельного архитектурного решения и не подменяется этим
launcher-ом.
