# WT-646 — Windows Docker Desktop autostart

## Статус

Завершено.

## Цель

Убрать из Windows-сценария host-а ручной старт Docker Desktop. Launcher
`Start-Spectemus-Simul.cmd` должен сам открыть уже установленное приложение и
подождать готовности daemon до запуска LAN-стека.

## Реализация

- Launcher сначала проверяет Docker daemon через `docker.exe version`.
- Если daemon не готов, он ищет Docker Desktop в стандартной machine-wide
  папке `%ProgramFiles%\\Docker\\Docker` и затем в user-level папке
  `%LOCALAPPDATA%\\Docker`.
- Найденный `Docker Desktop.exe` запускается через `start`, после чего launcher
  проверяет daemon каждые две секунды, но не дольше двух минут.
- При отсутствии Docker Desktop или истечении времени окно остаётся открытым с
  понятной причиной. Launcher не трогает firewall, router, port forwarding или
  cloud resources.

## Использование

1. Установите Node.js, pnpm и Docker Desktop один раз.
2. В Проводнике дважды нажмите `Start-Spectemus-Simul.cmd`.
3. Если Docker Desktop был закрыт, launcher откроет его и дождётся готовности.
   Затем автоматически откроется страница host-а в браузере.

## Проверка

```bash
pnpm format:lan
pnpm test:lan
pnpm format:check
```

Автотест фиксирует оба безопасных пути поиска Docker Desktop, запуск через
`start`, ограниченное ожидание и видимый error path. Фактический запуск
проверяется на Windows host-е перед внешним релизом.

## Ограничения и следующий шаг

- Launcher не устанавливает Docker Desktop и не обходится без него.
- Нестандартные пути установки Docker Desktop честно дают понятную ошибку, а
  не пытаются искать исполняемые файлы по всему диску.
- Полное избавление пользователя от Docker и терминала остаётся задачей
  отдельного desktop-приложения с упакованным runtime.
