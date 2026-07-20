#!/bin/zsh

set -u

script_dir="$(cd -- "$(dirname -- "$0")" && pwd -P)"
cd "$script_dir" || exit 1

pause_on_error() {
  printf '\nНажмите Enter, чтобы закрыть это окно…'
  read -r
}

docker_is_ready() {
  docker version --format '{{.Server.Version}}' >/dev/null 2>&1
}

start_docker_desktop_if_needed() {
  if docker_is_ready; then
    return 0
  fi

  printf '%s\n' 'Открываем Docker Desktop и ждём его готовности…'
  if ! open -a Docker >/dev/null 2>&1; then
    printf '%s\n' 'Не удалось открыть Docker Desktop. Установите его и повторите запуск.'
    return 1
  fi

  for ((attempt = 1; attempt <= 60; attempt++)); do
    if docker_is_ready; then
      printf '%s\n' 'Docker Desktop готов.'
      return 0
    fi

    sleep 2
  done

  printf '%s\n' 'Docker Desktop не успел запуститься за две минуты. Проверьте его окно и повторите запуск.'
  return 1
}

if ! command -v pnpm >/dev/null 2>&1; then
  printf '%s\n' 'Не найден pnpm. Один раз установите Node.js LTS и pnpm, затем повторите запуск.'
  pause_on_error
  exit 1
fi

if ! start_docker_desktop_if_needed; then
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
