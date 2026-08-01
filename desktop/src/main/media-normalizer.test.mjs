import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  MediaNormalizationFailure,
  buildNormalizationArguments,
  buildProbeArguments,
  clearNormalizedMediaDirectory,
  parseMediaInventory,
  parseProgressLine,
  resolveVideoEncoder,
  runCommand,
} from "./media-normalizer.mjs";

test("normalizer создаёт H.264/AAC MP4 profile для macOS", () => {
  const argumentsList = buildNormalizationArguments({
    inputPath: "/private/input.mkv",
    outputPath: "/private/output.mp4",
    platform: "darwin",
  });

  assert.deepEqual(argumentsList.slice(0, 10), [
    "-hide_banner",
    "-nostdin",
    "-v",
    "error",
    "-progress",
    "pipe:1",
    "-y",
    "-i",
    "/private/input.mkv",
    "-map",
  ]);
  assert.ok(argumentsList.includes("h264_videotoolbox"));
  assert.ok(argumentsList.includes("aac"));
  assert.equal(argumentsList.at(-1), "/private/output.mp4");
});

test("normalizer выбирает Windows Media Foundation encoder", () => {
  assert.equal(resolveVideoEncoder("win32"), "h264_mf");
});

test("normalizer отказывает неизвестной платформе до запуска process", () => {
  assert.throws(
    () => resolveVideoEncoder("linux"),
    (error) =>
      error instanceof MediaNormalizationFailure &&
      error.code === "UNSUPPORTED_PLATFORM",
  );
});

test("normalizer читает только codecs и безопасные media dimensions из ffprobe JSON", () => {
  assert.deepEqual(
    parseMediaInventory(
      JSON.stringify({
        format: { duration: "95.4", size: "123456" },
        streams: [
          { codec_type: "video", codec_name: "hevc" },
          { codec_type: "audio", codec_name: "dts" },
        ],
      }),
    ),
    { audio: "dts", durationSeconds: 95.4, sizeBytes: 123456, video: "hevc" },
  );
});

test("normalizer строит валидный ffprobe inventory query", () => {
  assert.deepEqual(buildProbeArguments("/private/movie.mkv"), [
    "-v",
    "error",
    "-show_entries",
    "format=duration,size:stream=codec_type,codec_name",
    "-of",
    "json",
    "/private/movie.mkv",
  ]);
});

test("normalizer переводит ffmpeg progress в безопасный процент", () => {
  assert.equal(parseProgressLine("out_time_us=45000000", 90), 50);
  assert.equal(parseProgressLine("out_time_us=999999999", 90), 100);
  assert.equal(parseProgressLine("progress=continue", 90), null);
});

test("normalizer очищает временные копии, оставленные аварийно закрытым приложением", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "spectemus-normalized-media-"),
  );
  const staleCopy = join(directory, "stale.mp4");
  await writeFile(staleCopy, "temporary movie");

  await clearNormalizedMediaDirectory(directory);

  await assert.rejects(() => stat(staleCopy));
});

test("normalizer отменяет зависший ffprobe вместе с его процессом", async () => {
  const controller = new AbortController();
  const child = createChild();
  const command = runCommand({
    args: ["-of", "json"],
    command: "ffprobe",
    label: "ffprobe",
    signal: controller.signal,
    spawnProcess: () => child,
    timeoutMs: 1_000,
  });

  controller.abort();
  child.emit("close", null);

  await assert.rejects(
    command,
    (error) =>
      error instanceof MediaNormalizationFailure && error.code === "CANCELLED",
  );
  assert.deepEqual(child.signals, ["SIGTERM"]);
});

test("normalizer принудительно завершает ffprobe, если SIGTERM не сработал", async () => {
  const child = createChild({
    closeOnSignal: "SIGKILL",
  });
  const command = runCommand({
    args: ["-of", "json"],
    command: "ffprobe",
    forceKillWaitMs: 1,
    label: "ffprobe",
    spawnProcess: () => child,
    timeoutMs: 1,
  });

  await assert.rejects(
    command,
    (error) =>
      error instanceof MediaNormalizationFailure &&
      error.code === "PROBE_FAILED",
  );
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

function createChild({ closeOnSignal } = {}) {
  const child = new EventEmitter();
  child.signals = [];
  child.kill = (signal) => {
    child.signals.push(signal);
    if (signal === closeOnSignal) {
      queueMicrotask(() => child.emit("close", null));
    }
    return true;
  };
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  return child;
}
