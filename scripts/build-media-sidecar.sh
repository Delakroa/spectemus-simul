#!/usr/bin/env bash
set -euo pipefail

readonly FFMPEG_VERSION="8.1.2"
readonly FFMPEG_ARCHIVE="ffmpeg-${FFMPEG_VERSION}.tar.xz"
# Начинаем с официального release URL. Зеркала ниже используются только когда он
# временно недоступен; доверие к архиву всё равно появляется лишь после GPG
# verification закреплённым ключом FFmpeg.
readonly FFMPEG_OFFICIAL_RELEASES_URL="https://ffmpeg.org/releases"
readonly FFMPEG_VIDEOLAN_MIRROR_URL="https://download.videolan.org/pub/contrib/ffmpeg"
readonly FFMPEG_ALIYUN_MIRROR_URL="https://mirrors.aliyun.com/slackware/slackware-current/source/l/ffmpeg"
readonly SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Отпечаток и открытая часть релизного ключа FFmpeg закреплены намеренно. Не получаем
# ключ с того же хоста, что и архив: его временная недоступность не должна останавливать
# installer, а хост с подменённым архивом мог бы отдать подходящий поддельный ключ.
# Проверяем, что импортирован именно ожидаемый ключ (last-16 отпечатка — общеизвестный
# key id B4322F04D67658D8).
readonly FFMPEG_SIGNING_KEY_FINGERPRINT="FCF986EA15E6E293A5644F10B4322F04D67658D8"
readonly FFMPEG_SIGNING_KEY="$SCRIPT_DIRECTORY/ffmpeg-release-signing-key.asc"
readonly FFMPEG_ARCHIVE_SIGNATURE="$SCRIPT_DIRECTORY/$FFMPEG_ARCHIVE.asc"
readonly DOWNLOAD_RETRY_ATTEMPTS="${DOWNLOAD_RETRY_ATTEMPTS:-7}"
readonly DOWNLOAD_RETRY_DELAY_SECONDS="${DOWNLOAD_RETRY_DELAY_SECONDS:-5}"
readonly DOWNLOAD_RETRY_MAX_DELAY_SECONDS="${DOWNLOAD_RETRY_MAX_DELAY_SECONDS:-60}"
readonly DOWNLOAD_CONNECT_TIMEOUT_SECONDS="${DOWNLOAD_CONNECT_TIMEOUT_SECONDS:-60}"

download_with_retry() {
  local destination="$1"
  shift
  local -a urls=("$@")
  local partial="${destination}.partial"
  local attempt
  local delay_seconds="$DOWNLOAD_RETRY_DELAY_SECONDS"
  local url

  if ((${#urls[@]} == 0)); then
    echo "Не указан URL для загрузки ${destination}." >&2
    return 2
  fi

  for ((attempt = 1; attempt <= DOWNLOAD_RETRY_ATTEMPTS; attempt += 1)); do
    url="${urls[$(((attempt - 1) % ${#urls[@]}))]}"
    rm -f "$partial"
    # --max-time нужен вдобавок к --connect-timeout: соединение может установиться и
    # затем встать, и без общего лимита job висит до своего таймаута.
    if curl --fail --location --show-error --connect-timeout "$DOWNLOAD_CONNECT_TIMEOUT_SECONDS" --max-time 900 --output "$partial" "$url"; then
      mv "$partial" "$destination"
      return 0
    fi

    rm -f "$partial"
    if ((attempt < DOWNLOAD_RETRY_ATTEMPTS)); then
      echo "Не удалось скачать ${url} (попытка ${attempt}/${DOWNLOAD_RETRY_ATTEMPTS}); повторяем через ${delay_seconds} с." >&2
      sleep "$delay_seconds"
      delay_seconds=$((delay_seconds * 2))
      if ((delay_seconds > DOWNLOAD_RETRY_MAX_DELAY_SECONDS)); then
        delay_seconds="$DOWNLOAD_RETRY_MAX_DELAY_SECONDS"
      fi
    fi
  done

  echo "Не удалось скачать ${destination} после ${DOWNLOAD_RETRY_ATTEMPTS} попыток." >&2
  return 1
}

# FFmpeg собирается в MinGW64 как набор DLL. На runner-е команда
# `ffmpeg -version` может незаметно найти runtime GCC/winpthreads через
# /mingw64/bin в PATH. На обычном Windows этого каталога нет, и тот же
# ffmpeg падает до запуска с 0xC0000135. Кладём runtime рядом с
# ffmpeg.exe/ffprobe.exe, как того требует Windows DLL search order, и
# вместе с ним сохраняем лицензионные тексты.
stage_windows_runtime_dependencies() {
  local output="$1"
  local mingw_prefix="${2:-${MINGW_PREFIX:-}}"

  [[ -n "$mingw_prefix" ]] || {
    echo "MINGW_PREFIX не задан: нельзя подготовить Windows runtime FFmpeg." >&2
    return 1
  }

  local output_bin="$output/bin"
  local gcc_license_directory="$mingw_prefix/share/licenses/gcc-libs"
  local winpthread_license_directory="$mingw_prefix/share/licenses/libwinpthread"
  local -a required_files=(
    "$mingw_prefix/bin/libgcc_s_seh-1.dll:$output_bin/libgcc_s_seh-1.dll"
    "$mingw_prefix/bin/libstdc++-6.dll:$output_bin/libstdc++-6.dll"
    "$mingw_prefix/bin/libwinpthread-1.dll:$output_bin/libwinpthread-1.dll"
    "$gcc_license_directory/COPYING3:$output/MINGW-GCC-COPYING3.txt"
    "$gcc_license_directory/COPYING.RUNTIME:$output/MINGW-GCC-RUNTIME-EXCEPTION.txt"
    "$winpthread_license_directory/COPYING:$output/MINGW-WINPTHREAD-LICENSE.txt"
  )
  local entry
  local source
  local destination

  for entry in "${required_files[@]}"; do
    source="${entry%%:*}"
    destination="${entry#*:}"
    [[ -r "$source" ]] || {
      echo "Не найден Windows runtime или его лицензия: $source" >&2
      return 1
    }
    cp "$source" "$destination"
  done
}

usage() {
  echo "Usage: scripts/build-media-sidecar.sh --output <directory> --source-output <directory>" >&2
  exit 2
}

main() {
  local gpg_command="${GPG_COMMAND:-gpg}"
  local output=""
  local source_output=""
  local work_directory
  local archive
  local signature
  local source_directory
  local ffmpeg_binary
  local ffprobe_binary
  local -a configure_options

  if ! command -v "$gpg_command" >/dev/null 2>&1 && [[ -x "/opt/homebrew/opt/gnupg/bin/gpg" ]]; then
    gpg_command="/opt/homebrew/opt/gnupg/bin/gpg"
  fi
  command -v "$gpg_command" >/dev/null 2>&1 || {
    echo "Для проверки подписи FFmpeg нужен gpg." >&2
    exit 1
  }
  [[ -r "$FFMPEG_SIGNING_KEY" ]] || {
    echo "Не найден закреплённый открытый ключ подписи FFmpeg: $FFMPEG_SIGNING_KEY" >&2
    exit 1
  }
  [[ -r "$FFMPEG_ARCHIVE_SIGNATURE" ]] || {
    echo "Не найдена закреплённая подпись архива FFmpeg: $FFMPEG_ARCHIVE_SIGNATURE" >&2
    exit 1
  }

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --output)
        output="${2:-}"
        shift 2
        ;;
      --source-output)
        source_output="${2:-}"
        shift 2
        ;;
      *)
        usage
        ;;
    esac
  done

  [[ -n "$output" && -n "$source_output" ]] || usage

  work_directory="$(mktemp -d)"
  # Адрес каталога разворачивается при установке trap. EXIT запускается уже после
  # возврата из main(), когда её local-переменные недоступны при set -u.
  trap "rm -rf -- $(printf '%q' "$work_directory")" EXIT

  archive="$work_directory/$FFMPEG_ARCHIVE"
  signature="$archive.asc"
  download_with_retry "$archive" \
    "$FFMPEG_OFFICIAL_RELEASES_URL/$FFMPEG_ARCHIVE" \
    "$FFMPEG_VIDEOLAN_MIRROR_URL/$FFMPEG_ARCHIVE" \
    "$FFMPEG_ALIYUN_MIRROR_URL/$FFMPEG_ARCHIVE"
  cp "$FFMPEG_ARCHIVE_SIGNATURE" "$signature"

  # Изолированный keyring: проверка не зависит от ключей, уже лежащих у пользователя или
  # на переиспользуемом runner, и не засоряет их. Каталог лежит внутри work_directory,
  # поэтому удаляется общим cleanup.
  export GNUPGHOME="$work_directory/gnupg"
  mkdir -p "$GNUPGHOME"
  chmod 700 "$GNUPGHOME"

  "$gpg_command" --batch --import "$FFMPEG_SIGNING_KEY"
  if ! "$gpg_command" --batch --with-colons --fingerprint \
    | grep -q "^fpr:::::::::${FFMPEG_SIGNING_KEY_FINGERPRINT}:"; then
    echo "Ключ подписи FFmpeg не совпал с закреплённым отпечатком ${FFMPEG_SIGNING_KEY_FINGERPRINT}." >&2
    echo "Сборка остановлена: архив не считается доверенным." >&2
    exit 1
  fi

  # Keyring содержит только проверенный ключ, поэтому успешная проверка подписи означает,
  # что архив подписан именно им.
  "$gpg_command" --batch --verify "$signature" "$archive"

  mkdir -p "$source_output"
  cp "$archive" "$source_output/$FFMPEG_ARCHIVE"
  cp "$signature" "$source_output/$FFMPEG_ARCHIVE.asc"
  tar -xf "$archive" -C "$work_directory"
  source_directory="$work_directory/ffmpeg-${FFMPEG_VERSION}"

  mkdir -p "$output"
  configure_options=(
    "--prefix=$output"
    "--disable-gpl"
    "--disable-nonfree"
    # Не подхватываем библиотеки, случайно установленные на runner-е. Иначе
    # Windows-сборка незаметно линкуется с zlib/iconv из MSYS2 и запускается
    # только пока их DLL присутствуют в PATH сборочной машины.
    "--disable-autodetect"
    "--enable-shared"
    "--disable-static"
    "--disable-debug"
    "--disable-doc"
    "--disable-ffplay"
    "--disable-network"
  )

  case "$(uname -s)" in
    Darwin)
      configure_options+=(
        "--enable-videotoolbox"
        "--enable-audiotoolbox"
        "--install-name-dir=@rpath"
        "--extra-ldflags=-Wl,-rpath,@executable_path/../lib"
      )
      ;;
    MINGW* | MSYS*)
      configure_options+=(
        "--arch=x86_64"
        "--target-os=mingw32"
        # Media Foundation encoder использует D3D11-типы даже для software
        # frames. После --disable-autodetect включаем эту системную часть явно.
        "--enable-d3d11va"
        "--enable-mediafoundation"
      )
      ;;
    *)
      echo "Unsupported media sidecar build platform: $(uname -s)" >&2
      exit 1
      ;;
  esac

  (
    cd "$source_directory"
    ./configure "${configure_options[@]}"
    make -j"$(getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.logicalcpu)"
    make install
  )

  if [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* ]]; then
    stage_windows_runtime_dependencies "$output"
  fi

  ffmpeg_binary="$output/bin/ffmpeg"
  ffprobe_binary="$output/bin/ffprobe"
  if [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* ]]; then
    ffmpeg_binary="$output/bin/ffmpeg.exe"
    ffprobe_binary="$output/bin/ffprobe.exe"
  fi
  "$ffmpeg_binary" -hide_banner -encoders | grep -q "$( [[ "$(uname -s)" == Darwin ]] && echo h264_videotoolbox || echo h264_mf )"
  "$ffprobe_binary" -version >/dev/null

  cp "$source_directory/COPYING.LGPLv2.1" "$output/FFMPEG-LGPL-2.1.txt"
  cat >"$output/FFMPEG-NOTICE.txt" <<EOF
Spectemus Simul includes FFmpeg ${FFMPEG_VERSION} as separate dynamically linked executables and libraries.
FFmpeg is licensed under LGPL version 2.1 or later.
Source archive: ${FFMPEG_ARCHIVE}
Official source URL: ${FFMPEG_OFFICIAL_RELEASES_URL}/${FFMPEG_ARCHIVE}
Configure command:
./configure ${configure_options[*]}
No FFmpeg source patches are applied by this build.
EOF

  if [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* ]]; then
    cat >"$output/MINGW-RUNTIME-NOTICE.txt" <<EOF
Spectemus Simul bundles the MinGW-w64 GCC runtime and winpthreads DLLs required
to run this FFmpeg build on a Windows computer without an MSYS2 installation.
Their license and GCC Runtime Library Exception texts are included next to this notice.
EOF
  fi

  echo "[ok] FFmpeg ${FFMPEG_VERSION} media sidecar is ready in $output"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
