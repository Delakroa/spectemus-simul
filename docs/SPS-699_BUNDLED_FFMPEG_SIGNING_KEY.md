# SPS-699 — локальный ключ подписи FFmpeg для installer

## Причина

Preview installer-run `31250001441` подтвердил исправление SPS-698: macOS
Apple Silicon успешно собрал DMG, смонтировал его и выполнил smoke установленного
приложения. Одновременно Windows job получил reset/timeout при скачивании
`https://ffmpeg.org/ffmpeg-devel.asc` и исчерпал семь попыток. Архив FFmpeg и
его `.asc` подпись уже были на runner; сборка зависела только от повторной
загрузки публичного ключа.

Публичный ключ не является секретом. Его fingerprint уже закреплён в скрипте и
сверяется при каждой сборке:

```text
FCF986EA15E6E293A5644F10B4322F04D67658D8
```

## Изменения

- открытая часть ключа хранится в
  `scripts/ffmpeg-release-signing-key.asc`;
- сборщик импортирует этот file в изолированный временный keyring, затем
  сверяет fingerprint и проверяет `.asc` подпись архива;
- сетевыми остаются только архив FFmpeg и его signature. Повторная загрузка
  открытого ключа больше не нужна;
- regression test делает fake `curl` ошибочным для `ffmpeg-devel.asc` и
  подтверждает, что сборщик импортирует именно versioned key file из
  репозитория.

## Проверка

```bash
bash -n scripts/build-media-sidecar.sh
node --test scripts/build-media-sidecar.test.mjs
pnpm test:lan
pnpm format:installer
```

Полную криптографическую проверку выполняет runner с GnuPG во время следующего
`Desktop installer`: если file повреждён или его fingerprint не совпадает,
сборка остановится до распаковки и компиляции FFmpeg.

## Граница и следующий шаг

SPS-699 не заменяет официальный архив и его signature зеркалом, не отключает
GPG verification и не меняет состав FFmpeg. После merge нужен новый preview
installer-run для macOS arm64, macOS x64 и Windows; затем — физическая
Mac ↔ Windows matrix фазы 0.
