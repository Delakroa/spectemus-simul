#!/bin/zsh

set -u

script_dir="$(cd -- "$(dirname -- "$0")" && pwd -P)"
cd "$script_dir" || exit 1

pause_on_error() {
  printf '\nНажмите Enter, чтобы закрыть это окно…'
  read -r
}

if ! command -v pnpm >/dev/null 2>&1; then
  printf '%s\n' 'Не найден pnpm. Один раз установите Node.js LTS и pnpm, затем повторите запуск.'
  pause_on_error
  exit 1
fi

if ! docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then
  printf '%s\n' 'Docker Desktop не запущен. Откройте Docker Desktop, дождитесь статуса Running и повторите запуск.'
  pause_on_error
  exit 1
fi

printf '%s\n' 'Запускаем Spectemus Simul Host для домашней сети…'
if ! pnpm host:lan:start; then
  printf '%s\n' 'Не удалось запустить Host mode. Прочитайте сообщение выше и повторите после исправления причины.'
  pause_on_error
  exit 1
fi

host_ip="$(awk -F= '/^LIVEKIT_NODE_IP=/{ print $2; exit }' infra/lan.env)"
if [[ -z "$host_ip" ]]; then
  printf '%s\n' 'Host mode запущен, но не удалось прочитать его LAN-адрес.'
  pause_on_error
  exit 1
fi

if ! open "http://${host_ip}:8088"; then
  printf '%s\n' 'Host mode запущен, но браузер не удалось открыть автоматически.'
  pause_on_error
  exit 1
fi
