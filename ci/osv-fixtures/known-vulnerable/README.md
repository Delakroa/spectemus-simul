# Known-vulnerable OSV fixture

`package-lock.json.fixture` фиксирует `lodash@4.17.20` для smoke-проверки
fail-closed поведения OSV.

Файл намеренно не называется `package-lock.json`, чтобы Dependency review и
recursive OSV scan репозитория не считали его product-зависимостью.

Job `OSV fail-closed smoke` копирует fixture во временный `package-lock.json`
и ожидает exit code `1`. Не устанавливать в product. Не чинить в SPS-718.
