# WT-657 — Desktop install smoke

## Цель

Не считать DMG или NSIS корректным только потому, что `electron-builder` создал
файл. Preview и signed сборки должны проходить минимальную проверку установки на
соответствующем GitHub runner до публикации artifact.

## Реализованное поведение

- macOS job монтирует готовый DMG в новую временную точку и проверяет
  `Spectemus Simul.app` внутри образа.
- Windows job запускает готовый NSIS installer в отдельную временную папку,
  проверяет установленное приложение и тихо удаляет его после проверки.
- Общий Node smoke проверяет непустые файлы: desktop executable, React UI,
  Spring Boot jar, bundled Java runtime и LiveKit sidecar. Имена платформенных
  executable (`java`/`java.exe`, `livekit-server`/`livekit-server.exe`) также
  закреплены в проверке.
- Smoke выполняется как для unsigned preview, так и для signed workflow.

## Что это доказывает и чего не доказывает

Проверка доказывает, что созданный installer отдаёт приложению все пять
обязательных runtime-компонентов. Она не открывает графическое окно, не
проверяет подпись/notarization и не может заменить реальный сценарий host и
guest между физическими Mac и Windows в LAN.

Перед первым release по-прежнему нужны production credentials, signed artifact
и ручной smoke на чистой macOS и Windows: запуск приложения, создание комнаты,
приглашение guest, publish H.264/AAC MP4, seek, chat, voice и корректное
завершение sidecars после закрытия.
