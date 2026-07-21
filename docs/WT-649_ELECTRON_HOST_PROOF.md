# WT-649 — Electron host proof

## Цель

Проверить desktop runtime без Docker: Electron запускает React UI, Spring Boot
с profile `desktop`, одиночный LiveKit Server и LAN gateway. Это ещё не
инсталлятор: sidecar-ресурсы и подпись появятся в WT-650.

## Контур

```text
Electron main process
├─ Spring Boot: 127.0.0.1:8080, profile=desktop
├─ LiveKit Server: LAN media ports, per-installation key/secret
└─ Node gateway: 0.0.0.0:8088
   ├─ React SPA
   └─ /api HTTP + WebSocket -> 127.0.0.1:8080
```

- Gateway сохраняет исходный `Host`, поэтому backend выдаёт guest-у LiveKit URL
  с тем же private LAN IPv4.
- Secrets генерируются один раз в app data с правами пользователя; они не
  передаются в renderer, invite-ссылки или status UI.
- Если найдено несколько физических private IPv4, host не угадывает сеть:
  нужен явный `SPECTEMUS_LAN_IP`.
- При выходе Electron корректно закрывает gateway, LiveKit и backend.

## Developer запуск proof

```sh
pnpm install
pnpm desktop:prepare
```

Затем укажите Java 25 и LiveKit Server. Официальные release assets есть для
Windows; для macOS официальный способ developer установки — `brew install
livekit`. Передайте пути через `SPECTEMUS_JAVA_COMMAND` и
`SPECTEMUS_LIVEKIT_SERVER` и запустите:

```sh
SPECTEMUS_JAVA_COMMAND=/path/to/java-25 \
SPECTEMUS_LIVEKIT_SERVER=/path/to/livekit-server \
pnpm desktop:dev
```

Если на компьютере больше одной домашней сети, дополнительно передайте
`SPECTEMUS_LAN_IP=192.168.x.x`. BrowserWindow открывает loopback gateway, а
гостю отправляется `http://<выбранный-ip>:8088/rooms/<room-id>`.

## Что проверено кодом

- выбор единственного private IPv4 и отказ при неоднозначной сети;
- per-installation secrets и LiveKit config без Redis;
- SPA fallback, HTTP proxy и WebSocket upgrade в loopback backend;
- desktop profile стартует без Redis (WT-648 backend test).

## Не является готовым релизом

- Нет DMG/MSI, code signing, auto-update или first-run firewall UX.
- macOS LiveKit пока не упакован: upstream не прикладывает macOS binary asset к
  release. WT-650 должен добавить воспроизводимую CI-сборку и подпись sidecar.
- Physical LAN smoke на чистых macOS/Windows ещё нужен после подготовки
  sidecar-ресурсов.
