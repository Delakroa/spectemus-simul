# WT-669 — стабильное имя backend JAR

## Проблема

Desktop development-путь и packaging ожидали файл с версией `0.1.0-SNAPSHOT` в
имени. После обычного повышения версии backend JAR менял бы имя, и desktop host
переставал бы находить его до ручной правки нескольких файлов.

## Решение

Gradle теперь всегда выпускает boot JAR под именем
`spectemus-simul-backend.jar`. Тот же путь используют development runtime и
electron-builder при упаковке приложения, а preflight проверяет его перед
сборкой Mac- и Windows-инсталляторов.

## Проверка

`./gradlew bootJar` создаёт стабильный файл, а `pnpm --dir desktop test`
проверяет путь runtime.
