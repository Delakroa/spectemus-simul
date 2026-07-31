import assert from "node:assert/strict";
import test from "node:test";

import {
  MediaNormalizationFailure,
  buildNormalizationArguments,
  buildProbeArguments,
  parseMediaInventory,
  parseProgressLine,
  resolveVideoEncoder,
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
