# SPS-734 — единый public origin для Internet desktop installer

## Зачем

Обычный DMG/NSIS намеренно собирается с выключенным Internet mode. Раньше
оператор мог включить Internet frontend отдельно, но установленный Electron
host всё равно требовал переменную `SPECTEMUS_PUBLIC_API_ORIGIN` при каждом
запуске. Эти два адреса могли разойтись: room/invite создавались на одном
сервере, а ссылка гостю указывала на другой.

## Решение

- Обычная сборка принудительно задаёт frontend `VITE_INTERNET_ROOM_RUNTIME_ENABLED=false`
  и не вшивает public origin, даже если в окружении остались старые Vite-переменные.
  Обе desktop-сборки также принудительно оставляют `VITE_API_BASE_URL` пустым:
  браузерный UI не уводится на сторонний API из окружения сборщика.
- Только явный `SPECTEMUS_PUBLIC_BUILD_ENABLED=true` вместе с
  `SPECTEMUS_PUBLIC_API_ORIGIN=https://app.<domain>` включает opt-in Internet
  сборку. Скрипт проверяет публичный HTTPS origin без credentials/path/query/hash
  и отклоняет однословные, локальные и тестовые домены. Он не проверяет DNS;
  это делает staging preflight на реальном стенде. Frontend и Electron получают
  один нормализованный адрес из этого ввода.
- Electron читает адрес из упакованного `public-build-config.json`, а не из
  переменной окружения при запуске. Отсутствующий файл выключает Internet
  привязку. Неверная конфигурация также не подменяется внешним URL.
- Packaging preflight сверяет manifest с выбранным режимом и проверяет, что
  public origin присутствует в собранном frontend. Installed-app smoke сверяет
  тот же manifest уже внутри DMG/NSIS.
- Если новая сборка указывает на другой public origin, прежняя сохранённая
  device-сессия не используется для комнат и токенов. Host сначала отзывает её
  на старом сервере, затем привязывается заново.

## Как собрать закрытый staging installer

В workflow `Desktop installer` оставить `public_origin` пустым для привычных
LAN-артефактов. Для закрытого Internet-стенда указать реальный
`https://app.<domain>` в `public_origin`. Workflow передаёт один и тот же адрес
в три сборки (Mac ARM, Mac Intel, Windows). До скачивания FFmpeg/LiveKit он
отклоняет неверный адрес. Сборка с `public_origin` не включает серверные
`PUBLIC_ACCESS_*` сама и не доказывает доступность DNS/TLS/WSS/TURN.

Для локальной операторской сборки на macOS:

```bash
SPECTEMUS_PUBLIC_BUILD_ENABLED=true \
SPECTEMUS_PUBLIC_API_ORIGIN='https://app.your-domain.org' \
pnpm desktop:package:preview:mac
```

На Windows те же две переменные задаются в окружении PowerShell перед
`pnpm desktop:package:preview:win`. Пустой/неверный адрес останавливает
подготовку до packaging. Обычные команды без флага продолжают собирать LAN.

## Проверки и границы

```bash
node --test desktop/src/main/public-build-config.test.mjs scripts/desktop-prepare.test.mjs
pnpm test:lan
pnpm check
```

Тесты покрывают отключённый default, общий origin, malformed/loopback URL,
подмену runtime environment, смену сервера при сохранённой device-сессии,
отсутствующий manifest и неполную сборку. Полный installer smoke на трёх
платформах, реальный сервер и межсетевой просмотр остаются финальным gate.

Если прежний сервер при смене origin уже недоступен, безопасный удалённый отзыв
сессии не удастся; автоматического «забыть локально» нет. Нужна отдельная
политика восстановления, а не молчаливое удаление credential.

Откат — собрать installer с пустым `public_origin`: Internet UI снова скрыт,
LAN runtime не меняется. Отзыв уже существующей public device-сессии при смене
сервера остаётся отдельным явным действием host-а.
