# SPS-700 — целостность OpenPGP armour ключа FFmpeg

## Причина

После merge SPS-699 preview-run `31250926942` дошёл до настоящего GnuPG на
macOS Apple Silicon и остановился до распаковки FFmpeg:

```text
gpg: CRC error
gpg: import from 'scripts/ffmpeg-release-signing-key.asc' failed: Invalid keyring
```

Один символ base64 payload в добавленном ASCII-armour был искажён. Закреплённый
fingerprint и независимый keyring не были обойдены: GnuPG корректно отклонил
нецелостный публичный ключ. Локальные unit-тесты SPS-699 подставляли GnuPG и
проверяли путь импорта, но не проверяли checksum armour.

## Изменения

- восстановлен точный ASCII-armour публичного ключа FFmpeg;
- `scripts/build-media-sidecar.test.mjs` вычисляет OpenPGP CRC-24 payload и
  сверяет его с checksum из файла;
- документация SPS-699 уточняет обе защиты regression-теста: отсутствие
  сетевой загрузки ключа и целостность armour.

## Проверка

```bash
node --test scripts/build-media-sidecar.test.mjs
bash -n scripts/build-media-sidecar.sh
pnpm format:installer
git diff --check
```

После merge нужен новый `Desktop installer`. Настоящий GnuPG на macOS и Windows
должен импортировать ключ, сверить fingerprint
`FCF986EA15E6E293A5644F10B4322F04D67658D8` и проверить signature исходного
архива до его распаковки.

## Граница

SPS-700 не меняет trust model, release key, источник архива или требования к
GPG verification. Это только исправление повреждённого публичного файла и
локальный guard от повторения той же ошибки.
