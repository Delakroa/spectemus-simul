import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = join(process.cwd(), "scripts", "build-media-sidecar.sh");
const PINNED_FINGERPRINT = "FCF986EA15E6E293A5644F10B4322F04D67658D8";

/**
 * Готовит каталог с подставными curl и gpg и запускает скрипт с ним в начале PATH.
 * Проверка подписи выполняется до распаковки и сборки, поэтому при несовпадении ключа
 * скрипт обязан завершиться раньше, чем дойдёт до tar и configure.
 */
async function runWithStubs({ reportedFingerprint }) {
  const root = await mkdtemp(join(tmpdir(), "spectemus-media-sidecar-"));
  const binDirectory = join(root, "bin");
  await mkdir(binDirectory, { recursive: true });

  // curl создаёт пустой файл там, куда его просят записать (--output <path>), но
  // намеренно отказывает, если скрипт попробует снова скачать открытый ключ.
  await writeFile(
    join(binDirectory, "curl"),
    `#!/bin/sh
destination=""
url=""
while [ $# -gt 0 ]; do
  case "$1" in
    --output) destination="$2"; shift 2 ;;
    *) url="$1"; shift ;;
  esac
done
case "$url" in
  *ffmpeg-devel.asc) echo "Ключ не должен скачиваться" >&2; exit 91 ;;
esac
[ -n "$destination" ] && : > "$destination"
exit 0
`,
  );

  // gpg отвечает заданным отпечатком на --fingerprint и проверяет, что импортируется
  // закреплённый file из репозитория, а не скачанный runtime key.
  await writeFile(
    join(binDirectory, "gpg"),
    `#!/bin/sh
last=""
for argument in "$@"; do
  last="$argument"
  if [ "$argument" = "--fingerprint" ]; then
    echo "fpr:::::::::${reportedFingerprint}:"
    exit 0
  fi
done
case "$*" in
  *--import*) test "$last" = "$FFMPEG_SIGNING_KEY_PATH" || exit 92 ;;
esac
exit 0
`,
  );

  await chmod(join(binDirectory, "curl"), 0o755);
  await chmod(join(binDirectory, "gpg"), 0o755);

  const result = spawnSync(
    "bash",
    [
      script,
      "--output",
      join(root, "out"),
      "--source-output",
      join(root, "source"),
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${binDirectory}:${process.env.PATH}`,
        FFMPEG_SIGNING_KEY_PATH: join(
          process.cwd(),
          "scripts",
          "ffmpeg-release-signing-key.asc",
        ),
      },
    },
  );

  await rm(root, { recursive: true, force: true });
  return result;
}

test("сборка media sidecar останавливается, если ключ подписи не совпал с закреплённым", async () => {
  const result = await runWithStubs({
    reportedFingerprint: "0000000000000000000000000000000000000000",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /не совпал с закреплённым отпечатком/);
  assert.match(result.stderr, new RegExp(PINNED_FINGERPRINT));
  assert.doesNotMatch(result.stderr, /unbound variable/);
});

test("сборка media sidecar проходит проверку ключа при совпадении отпечатка", async () => {
  const result = await runWithStubs({
    reportedFingerprint: PINNED_FINGERPRINT,
  });

  // Дальше скрипт распаковывает пустой архив и падает уже на tar/configure — важно лишь,
  // что причина не в проверке ключа.
  assert.doesNotMatch(result.stderr, /не совпал с закреплённым отпечатком/);
  assert.doesNotMatch(result.stderr, /Ключ не должен скачиваться/);
});

test("загрузка FFmpeg повторяется после curl (35) и не публикует partial-файл", async () => {
  const root = await mkdtemp(join(tmpdir(), "spectemus-media-download-"));
  const binDirectory = join(root, "bin");
  const destination = join(root, "ffmpeg.tar.xz");
  const attemptsFile = join(root, "attempts");

  try {
    await mkdir(binDirectory, { recursive: true });
    await writeFile(attemptsFile, "0");
    await writeFile(
      join(binDirectory, "curl"),
      `#!/usr/bin/env bash
set -euo pipefail
attempts="$(cat \"$CURL_FAKE_ATTEMPTS\")"
attempts=$((attempts + 1))
printf "%s" "$attempts" > "$CURL_FAKE_ATTEMPTS"
output=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--output" ]]; then output="$2"; shift 2; continue; fi
  shift
done
if [[ "$attempts" == "1" ]]; then
  printf "partial" > "$output"
  exit 35
fi
printf "complete" > "$output"
`,
    );
    await chmod(join(binDirectory, "curl"), 0o755);

    const result = spawnSync(
      "bash",
      [
        "-c",
        'source "$1"; download_with_retry "$2" "$3"',
        "bash",
        script,
        destination,
        "https://example.test/ffmpeg.tar.xz",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDirectory}:${process.env.PATH}`,
          CURL_FAKE_ATTEMPTS: attemptsFile,
          DOWNLOAD_RETRY_ATTEMPTS: "2",
          DOWNLOAD_RETRY_DELAY_SECONDS: "0",
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(destination, "utf8"), "complete");
    assert.equal(await readFile(attemptsFile, "utf8"), "2");
    await assert.rejects(readFile(`${destination}.partial`));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("загрузка FFmpeg увеличивает паузу между временными сетевыми ошибками", async () => {
  const root = await mkdtemp(join(tmpdir(), "spectemus-media-backoff-"));
  const binDirectory = join(root, "bin");
  const destination = join(root, "ffmpeg.tar.xz");
  const attemptsFile = join(root, "attempts");
  const sleepFile = join(root, "sleep-delays");

  try {
    await mkdir(binDirectory, { recursive: true });
    await writeFile(attemptsFile, "0");
    await writeFile(
      join(binDirectory, "curl"),
      `#!/usr/bin/env bash
set -euo pipefail
attempts="$(cat \"$CURL_FAKE_ATTEMPTS\")"
attempts=$((attempts + 1))
printf "%s" "$attempts" > "$CURL_FAKE_ATTEMPTS"
output=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--output" ]]; then output="$2"; shift 2; continue; fi
  shift
done
if [[ "$attempts" -lt 3 ]]; then exit 35; fi
printf "complete" > "$output"
`,
    );
    await writeFile(
      join(binDirectory, "sleep"),
      `#!/usr/bin/env bash
printf "%s\\n" "$1" >> "$SLEEP_FAKE_DELAYS"
`,
    );
    await chmod(join(binDirectory, "curl"), 0o755);
    await chmod(join(binDirectory, "sleep"), 0o755);

    const result = spawnSync(
      "bash",
      [
        "-c",
        'source "$1"; download_with_retry "$2" "$3"',
        "bash",
        script,
        destination,
        "https://example.test/ffmpeg.tar.xz.asc",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDirectory}:${process.env.PATH}`,
          CURL_FAKE_ATTEMPTS: attemptsFile,
          SLEEP_FAKE_DELAYS: sleepFile,
          DOWNLOAD_RETRY_ATTEMPTS: "3",
          DOWNLOAD_RETRY_DELAY_SECONDS: "2",
          DOWNLOAD_RETRY_MAX_DELAY_SECONDS: "60",
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(destination, "utf8"), "complete");
    assert.equal(await readFile(attemptsFile, "utf8"), "3");
    assert.equal(await readFile(sleepFile, "utf8"), "2\n4\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
