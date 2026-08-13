# SPS-711 — Windows FFmpeg работает без среды разработки

## Проблема

Физический прогон Windows host показал, что MKV не доходит до
подготовки совместимой копии. Встроенный `ffmpeg.exe` падал уже на
`-version` с кодом `3221225781` (`0xC0000135`, не найден зависимый
компонент).

Installer smoke на GitHub runner оставался зелёным, потому что его
`PATH` содержал MSYS2 `/mingw64/bin`. Недостающие DLL подхватывались
с машины сборки, но не попадали в NSIS.

## Решение

- Windows media sidecar явно включает `libgcc_s_seh-1.dll` и
  `libwinpthread-1.dll` рядом с `ffmpeg.exe` и `ffprobe.exe`.
- В installer попадают тексты лицензий GCC Runtime Library Exception и
  winpthreads.
- Package preflight и installed-app smoke требуют эти файлы.
- Перед запуском Windows sidecar smoke заменяет `PATH` на каталог
  самого sidecar и системные каталоги Windows. Библиотеки MSYS2 больше
  не могут маскировать неполную сборку.

Пользователю по-прежнему не нужны Docker, FFmpeg, MSYS2 или другие
инструменты разработчика.

## Проверка

```bash
bash -n scripts/build-media-sidecar.sh
node --test scripts/build-media-sidecar.test.mjs scripts/desktop-installed-app-smoke.test.mjs
pnpm check
```

Ключевой release gate — `Desktop installer` на Windows: он устанавливает
NSIS в чистый каталог и запускает оба media sidecar без MSYS2 в `PATH`.
