# SPS-698 — безопасные sidecars для macOS bundle

## Причина

Повторный preview installer-run `31249287287` прошёл сборку FFmpeg, подготовку
sidecars и package preflight на Apple Silicon. На этапе ad-hoc подписи
`codesign --verify --deep --strict` остановил сборку:

```text
Spectemus Simul.app: invalid destination for symbolic link in bundle
```

Символические ссылки могли попасть в `Contents/Resources` из Java runtime или
media directory: staging копировал tree, сохраняя ссылки. Внутри macOS app
bundle их destination должен быть валиден в самом bundle; ссылка на путь вне
него делает установщик непригодным.

## Изменения

- staging Java runtime, LiveKit и FFmpeg/FFprobe теперь разворачивает symbolic
  links в обычные файлы до упаковки;
- после staging скрипт явно останавливается, если в `.sidecars` осталась хоть
  одна symbolic link;
- локальная команда `desktop:package:preview:mac` использует ту же ad-hoc
  подпись (`identity=-`), что и GitHub Actions. Локальная и CI-проверки больше
  не расходятся по способу упаковки.

## Проверка

```bash
node --test scripts/desktop-sidecars-stage.test.mjs
pnpm test:lan
pnpm format:installer
```

Regression test создаёт runtime и media fixtures с relative symbolic links и
проверяет, что в staged `.sidecars` на их месте обычные файлы.

## Граница и следующий шаг

SPS-698 не добавляет поддержку новых форматов и не меняет LAN/Internet
контракты. После merge необходимо заново запустить `Desktop installer` и
получить install smoke на macOS arm64, macOS x64 и Windows. Только затем
переходим к физической Mac ↔ Windows matrix фазы 0.
