# WT-645 — macOS Docker Desktop autostart

## Статус

Завершено.

## Цель

Убрать из Mac-сценария host-а лишнее ручное действие: Finder launcher должен
сам открыть уже установленный Docker Desktop, если daemon ещё не готов, и
дождаться запуска до старта LAN-стека.

## Реализация

- `Start-Spectemus-Simul.command` сначала проверяет доступность Docker daemon
  через `docker version`.
- Если daemon ещё не отвечает, launcher запускает установленный Docker Desktop
  штатной macOS-командой `open -a Docker`.
- Затем он проверяет готовность каждые две секунды, но не дольше двух минут.
  При успехе запускается прежний безопасный путь `pnpm host:lan:start`.
- Если Docker Desktop не установлен, не открывается или не стал готов за
  отведённое время, окно остаётся открытым с понятным сообщением. Никакие
  сетевые порты, router settings или cloud resources не меняются.

## Использование

1. Установите Node.js, pnpm и Docker Desktop один раз.
2. В Finder дважды нажмите `Start-Spectemus-Simul.command`.
3. Если Docker Desktop был закрыт, launcher откроет его и дождётся статуса
   готовности. Затем автоматически откроется страница host-а в браузере.

## Проверка

```bash
zsh -n Start-Spectemus-Simul.command
pnpm format:lan
pnpm test:lan
pnpm format:check
```

Автотест фиксирует наличие безопасной проверки daemon, штатного запуска
`open -a Docker`, ограниченного ожидания и сохранения видимого error path.

## Ограничения и следующий шаг

- Это не заменяет установку Docker Desktop и не пытается установить, обновить
  или настроить его без согласия владельца Mac.
- Windows launcher пока просит открыть Docker Desktop вручную; его автозапуск
  требует отдельной Windows-проверки путей и поведения системы.
- Полное избавление пользователя от Docker и терминала остаётся задачей
  отдельного desktop-приложения с упакованным runtime.
