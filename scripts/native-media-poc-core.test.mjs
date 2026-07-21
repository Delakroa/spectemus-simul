import assert from "node:assert/strict";
import test from "node:test";

import {
  assertNormalizedOutput,
  buildTranscodeArguments,
  parseProbeOutput,
} from "./native-media-poc-core.mjs";

const probe = JSON.stringify({
  format: { duration: "95.5", format_name: "matroska,webm", size: "1048576" },
  streams: [
    {
      codec_name: "hevc",
      codec_type: "video",
      height: 1080,
      width: 1920,
    },
    { channels: 6, codec_name: "dts", codec_type: "audio" },
  ],
});

test("ffprobe inventory сохраняет container, codecs и media dimensions", () => {
  assert.deepEqual(parseProbeOutput(probe), {
    audio: { channels: 6, codec: "dts" },
    container: "matroska,webm",
    durationSeconds: 95.5,
    sizeBytes: 1048576,
    video: { codec: "hevc", height: 1080, width: 1920 },
  });
});

test("transcode profile создаёт H.264/AAC MP4 command без upload пути", () => {
  const command = buildTranscodeArguments({
    inputPath: "/private/movie.mkv",
    outputPath: "/private/normalized.mp4",
    profile: "poc-libx264-aac",
  });
  assert.deepEqual(command.slice(0, 9), [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-i",
    "/private/movie.mkv",
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
  ]);
  assert.ok(command.includes("libx264"));
  assert.ok(command.includes("aac"));
  assert.equal(command.at(-1), "/private/normalized.mp4");
});

test("normalized output требует H.264 и AAC", () => {
  assert.throws(
    () =>
      assertNormalizedOutput({
        audio: { codec: "aac" },
        video: { codec: "hevc" },
      }),
    /H\.264/,
  );
  assert.throws(
    () =>
      assertNormalizedOutput({
        audio: { codec: "opus" },
        video: { codec: "h264" },
      }),
    /AAC/,
  );
});
