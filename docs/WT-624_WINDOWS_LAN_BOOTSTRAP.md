# WT-624 — Windows LAN bootstrap

## Цель

Убрать ручную настройку, которая блокировала реальную проверку Windows host →
Mac guest: Windows Firewall не пропускал gateway и LiveKit, поэтому Mac не мог
даже открыть `http://<Windows-IP>:8088`.

## Область

- Одна команда на Windows выбирает LAN IPv4, запрашивает стандартный UAC и
  создаёт только два ограниченных firewall-правила для профиля `Private`.
- После настройки она поднимает Docker LAN stack и запускает локальный doctor.
- Команда не действует на macOS/Linux, не включает port forwarding, не меняет
  router и не открывает порты для профилей `Public` или `Domain`.

## Использование

На Windows-компьютере с Docker Desktop, из корня репозитория и только в
доверенной домашней сети:

```bash
pnpm infra:lan:windows
```

При нескольких физических private IPv4 явно укажите адрес:

```bash
pnpm infra:lan:windows -- --ip 192.168.1.111
```

Команда выполняет последовательно:

1. `pnpm infra:lan:setup`;
2. `windows-lan-firewall.ps1` с UAC-подтверждением;
3. `pnpm infra:lan:up`;
4. `pnpm infra:lan:doctor`.

PowerShell-скрипт создаёт повторяемые правила только для:

| Протокол | Порты            | Назначение                                 |
| -------- | ---------------- | ------------------------------------------ |
| TCP      | 8088, 7880, 7881 | Gateway, LiveKit signalling и TCP fallback |
| UDP      | 50000–50100      | WebRTC media                               |

Если Windows пометил подключение как `Public`, команда остановится до изменения
firewall. Это намеренная граница безопасности: сначала в Windows Settings нужно
выбрать `Private` именно для своей домашней сети, затем повторить bootstrap.

После зелёного doctor на Windows выполните на Mac:

```bash
pnpm infra:lan:doctor -- --host 192.168.1.111
```

Только если оба doctor зелёные, Windows host открывает
`http://192.168.1.111:8088`, создаёт новую комнату по этому же адресу, а Mac
открывает новую invite-ссылку. Реальный совместный просмотр нужен для проверки
UDP media range.

Начиная с WT-635 pnpm-команды запускаются через Windows Command Processor,
поскольку прямой `spawn` файла `pnpm.cmd` на Node.js 24 может завершиться
ошибкой `EINVAL`. Путь репозитория с кириллицей поддерживается.

## Проверки

```bash
pnpm test:lan
pnpm format:check
pnpm check
```

`windows-lan-bootstrap.mjs --help` проверяется на любой OS. Фактические UAC,
Windows Firewall и Docker Desktop необходимо подтвердить на Windows host:
macOS не может безопасно выполнить эти системные действия за другой компьютер.
