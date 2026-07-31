#!/usr/bin/env bash
set -euo pipefail

readonly FFMPEG_VERSION="8.1.2"
readonly FFMPEG_ARCHIVE="ffmpeg-${FFMPEG_VERSION}.tar.xz"
readonly FFMPEG_BASE_URL="https://ffmpeg.org/releases"

gpg_command="${GPG_COMMAND:-gpg}"
if ! command -v "$gpg_command" >/dev/null 2>&1 && [[ -x "/opt/homebrew/opt/gnupg/bin/gpg" ]]; then
  gpg_command="/opt/homebrew/opt/gnupg/bin/gpg"
fi
command -v "$gpg_command" >/dev/null 2>&1 || {
  echo "Для проверки подписи FFmpeg нужен gpg." >&2
  exit 1
}

usage() {
  echo "Usage: scripts/build-media-sidecar.sh --output <directory> --source-output <directory>" >&2
  exit 2
}

output=""
source_output=""
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
cleanup() {
  rm -rf "$work_directory"
}
trap cleanup EXIT

archive="$work_directory/$FFMPEG_ARCHIVE"
signature="$archive.asc"
curl --fail --location --retry 3 --output "$archive" "$FFMPEG_BASE_URL/$FFMPEG_ARCHIVE"
curl --fail --location --retry 3 --output "$signature" "$FFMPEG_BASE_URL/$FFMPEG_ARCHIVE.asc"
curl --fail --location --retry 3 "https://ffmpeg.org/ffmpeg-devel.asc" | "$gpg_command" --batch --import
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
Source URL: ${FFMPEG_BASE_URL}/${FFMPEG_ARCHIVE}
Configure command:
./configure ${configure_options[*]}
No FFmpeg source patches are applied by this build.
EOF

echo "[ok] FFmpeg ${FFMPEG_VERSION} media sidecar is ready in $output"
