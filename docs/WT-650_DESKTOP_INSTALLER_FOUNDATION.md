# WT-650 — Desktop installer foundation

## Что подготовлено

- `electron-builder` конфигурация для macOS DMG/ZIP и Windows NSIS.
- В installer кладутся React build, Spring Boot jar, Java 25 runtime и LiveKit
  sidecar; desktop app не требует Node.js, pnpm, Docker или Redis.
- Preflight не даёт собрать installer без каждого из четырёх runtime inputs.
- Manual GitHub Actions workflow собирает отдельные macOS и Windows artifacts:
  macOS собирает исполняемый пакет `cmd/server` LiveKit из официального тега
  `v1.13.3` для x64 и Apple Silicon (Go 1.26, как требует pinned source),
  Windows получает официальный release archive `v1.13.3` с проверкой SHA-256.
  Intel job использует актуальный GitHub runner `macos-15-intel`; снятый
  `macos-13` нельзя использовать для release evidence.
- Preview artifacts строятся отдельно и явно отключают signing. Они нужны
  только для install smoke, а не для передачи пользователям.

## Release gate: нужны внешние credentials

Signed distribution нельзя честно завершить без секретов владельца продукта.
Для запуска workflow с `signed=true` в GitHub repository secrets должны быть:

| Platform | Required secrets                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------ |
| macOS    | `MACOS_CSC_LINK`, `MACOS_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |
| Windows  | `WINDOWS_CSC_LINK`, `WINDOWS_CSC_KEY_PASSWORD`                                                         |

macOS использует Developer ID Application certificate и notarization. Windows
требует OV/EV Authenticode certificate либо отдельную последующую миграцию на
Azure Trusted Signing. Production config включает `forceCodeSigning`, поэтому
отсутствие сертификата — ошибка сборки, а не скрытый unsigned release.
Отдельный preflight до начала build также перечисляет отсутствующие secrets;
поэтому `signed=true` не может незаметно превратиться в preview artifact.

## Первый install smoke после credentials

1. Запустить manual workflow `Desktop installer` с `signed=true`.
2. На чистом macOS/Windows установить artifact без Node.js, pnpm и Docker.
3. Открыть приложение, создать комнату, отправить LAN invite гостю.
4. Проверить MP4 H.264/AAC: publish, play/pause/seek, chat, voice, reconnect.
5. Закрыть приложение и убедиться, что gateway/backend/LiveKit не остались в
   фоне.

Локальная unsigned macOS preview-сборка была выполнена с тестовым sidecar:
получены DMG и ZIP, в app bundle проверены React, backend jar, Java runtime и
LiveKit path. Это подтверждает упаковку, но не заменяет signed install smoke
с реальным LiveKit на чистой машине.

2026-07-21 manual unsigned workflow из `main` успешно собрал и сохранил
preview artifacts с реальным LiveKit `v1.13.3` для macOS Intel, macOS Apple
Silicon и Windows NSIS. Это подтверждает воспроизводимость packaging на трёх
целевых GitHub runners; artifacts имеют retention 14 дней и не являются
release-дистрибутивом. Signed/notarized install smoke на чистых физических
машинах по-прежнему требует production signing credentials.

WT-657 дополняет этот foundation автоматической проверкой установленного
содержимого DMG и NSIS. Она ловит недостающий bundled runtime в CI, но не
заменяет запуск signed приложения на физических машинах.

В этой ветке не публикуются GitHub Release и не выполняется автообновление:
сначала нужен успешный signed install smoke на обеих ОС.
