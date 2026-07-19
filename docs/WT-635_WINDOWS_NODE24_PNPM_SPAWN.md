# WT-635 — Windows Node.js 24 pnpm spawn

## Проблема

На Windows с Node.js 24 команда `pnpm infra:lan:windows` завершалась на втором
шаге с `Error: spawn EINVAL`. Bootstrap пытался запустить `pnpm.cmd` напрямую
через `child_process.spawn(..., { shell: false })`, хотя `.cmd` является
скриптом Windows Command Processor, а не обычным executable.

Путь репозитория с кириллицей проявился в stack trace, но не был причиной:
ошибка возникала на границе прямого запуска `.cmd`.

## Исправление

- Pnpm-шаги bootstrap запускаются через `%ComSpec% /d /s /c`.
- Docker и PowerShell по-прежнему запускаются напрямую с `shell: false`.
- В command string допускаются только безопасные аргументы bootstrap.
- Перед передачей `--ip` дополнительно проверяется private IPv4, поэтому
  shell metacharacters не могут попасть в Command Processor.

## Проверки

    pnpm test:lan
    pnpm lint
    pnpm format:check

Тесты проверяют построение ComSpec invocation и отказ на shell
metacharacters. Фактический запуск Docker Desktop, UAC и firewall остаётся
Windows-only проверкой.

## Ручная проверка

На Windows с Node.js 24 из пути, содержащего кириллицу:

    pnpm infra:lan:windows

Ожидается последовательное выполнение setup, firewall, LAN stack и doctor без
`spawn EINVAL`.
