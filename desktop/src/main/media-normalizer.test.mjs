import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DesktopMediaNormalizer,
  MediaNormalizationFailure,
  assertSufficientDiskSpace,
  buildNormalizationArguments,
  buildProbeArguments,
  classifyTranscodeStderr,
  clearNormalizedMediaDirectory,
  createNormalizationPlan,
  estimateOutputBytes,
  parseMediaInventory,
  parseProgressLine,
  resolveVideoEncoder,
  runCommand,
} from "./media-normalizer.mjs";

test("normalizer создаёт H.264/AAC MP4 profile для macOS", () => {
  const plan = createNormalizationPlan(
    { audio: "flac", video: "hevc", videoPixelFormat: "yuv420p10le" },
    "darwin",
  );
  const argumentsList = buildNormalizationArguments({
    inputPath: "/private/input.mkv",
    outputPath: "/private/output.mp4",
    plan,
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

test("normalizer быстро remux-ит совместимые H.264/AAC дорожки без потери качества", () => {
  const plan = createNormalizationPlan(
    { audio: "aac", video: "h264", videoPixelFormat: "yuv420p" },
    "win32",
  );
  const argumentsList = buildNormalizationArguments({
    inputPath: "C:\\private\\input.mkv",
    outputPath: "C:\\private\\output.mp4",
    plan,
  });

  assert.deepEqual(plan, {
    copyAudio: true,
    copyVideo: true,
    mode: "remux",
    videoEncoder: null,
  });
  assert.equal(argumentsList[argumentsList.indexOf("-c:v") + 1], "copy");
  assert.equal(argumentsList[argumentsList.indexOf("-c:a") + 1], "copy");
  assert.ok(!argumentsList.includes("6000k"));
  assert.ok(!argumentsList.includes("160k"));
});

test("normalizer перекодирует только несовместимую аудиодорожку", () => {
  const plan = createNormalizationPlan(
    { audio: "dts", video: "h264", videoPixelFormat: "yuv420p" },
    "win32",
  );
  const argumentsList = buildNormalizationArguments({
    inputPath: "C:\\private\\input.mkv",
    outputPath: "C:\\private\\output.mp4",
    plan,
  });

  assert.equal(plan.mode, "partial");
  assert.equal(argumentsList[argumentsList.indexOf("-c:v") + 1], "copy");
  assert.equal(argumentsList[argumentsList.indexOf("-c:a") + 1], "aac");
  assert.ok(argumentsList.includes("160k"));
});

test("normalizer не копирует H.264 10-bit, который Chromium декодирует ненадёжно", () => {
  const plan = createNormalizationPlan(
    { audio: "aac", video: "h264", videoPixelFormat: "yuv420p10le" },
    "win32",
  );

  assert.equal(plan.copyVideo, false);
  assert.equal(plan.videoEncoder, "h264_mf");
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
          { codec_type: "video", codec_name: "hevc", pix_fmt: "yuv420p10le" },
          { codec_type: "audio", codec_name: "dts" },
        ],
      }),
    ),
    {
      audio: "dts",
      durationSeconds: 95.4,
      sizeBytes: 123456,
      video: "hevc",
      videoPixelFormat: "yuv420p10le",
    },
  );
});

test("normalizer строит валидный ffprobe inventory query", () => {
  assert.deepEqual(buildProbeArguments("/private/movie.mkv"), [
    "-v",
    "error",
    "-show_entries",
    "format=duration,size:stream=codec_type,codec_name,pix_fmt",
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

test("estimateOutputBytes растёт с длительностью и не считает неизвестную длительность", () => {
  assert.equal(estimateOutputBytes(0), null);
  assert.equal(estimateOutputBytes(null), null);
  assert.equal(estimateOutputBytes(Number.NaN), null);

  const twoHourFilm = estimateOutputBytes(2 * 60 * 60);
  const oneHourFilm = estimateOutputBytes(60 * 60);
  assert.ok(twoHourFilm > oneHourFilm * 1.9);
  // 2 часа при 6000k видео + 160k аудио — около 5,5 ГБ с учётом запаса.
  assert.ok(twoHourFilm > 5 * 1024 ** 3);
  assert.ok(twoHourFilm < 6.5 * 1024 ** 3);
  assert.equal(
    estimateOutputBytes(null, { copyVideo: true, sourceSizeBytes: 1_000_000 }),
    1_150_000,
  );
});

test("assertSufficientDiskSpace пропускает подготовку, когда места достаточно", async () => {
  await assert.doesNotReject(
    assertSufficientDiskSpace({
      outputDirectory: "/private/output",
      requiredBytes: 1_000,
      statDiskSpace: async () => ({ bavail: 10, bsize: 1_000 }),
    }),
  );
});

test("assertSufficientDiskSpace отказывает подготовку при нехватке места на диске", async () => {
  await assert.rejects(
    assertSufficientDiskSpace({
      outputDirectory: "/private/output",
      requiredBytes: 10_000,
      statDiskSpace: async () => ({ bavail: 1, bsize: 1_000 }),
    }),
    (error) =>
      error instanceof MediaNormalizationFailure &&
      error.code === "INSUFFICIENT_DISK_SPACE",
  );
});

test("assertSufficientDiskSpace не блокирует подготовку, если statfs недоступен", async () => {
  await assert.doesNotReject(
    assertSufficientDiskSpace({
      outputDirectory: "/private/output",
      requiredBytes: 10_000,
      statDiskSpace: async () => {
        throw new Error("statfs не реализован на этой платформе");
      },
    }),
  );
});

test("normalizer останавливается до запуска ffmpeg, если на диске не хватает места", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "spectemus-normalized-media-"),
  );
  let ffmpegSpawned = false;
  const normalizer = new DesktopMediaNormalizer({
    ffmpegPath: "ffmpeg",
    ffprobePath: "ffprobe",
    outputDirectory: directory,
    platform: "darwin",
    spawnProcess: (command) => {
      if (command === "ffprobe") {
        const child = createChild();
        queueMicrotask(() => {
          child.stdout.emit(
            "data",
            JSON.stringify({
              format: { duration: "7200", size: "1" },
              streams: [{ codec_type: "video", codec_name: "h264" }],
            }),
          );
          child.emit("close", 0);
        });
        return child;
      }
      ffmpegSpawned = true;
      return createChild();
    },
    statDiskSpace: async () => ({ bavail: 1, bsize: 1_000 }),
  });

  await assert.rejects(
    normalizer.normalize({ inputPath: "/private/movie.mkv" }),
    (error) =>
      error instanceof MediaNormalizationFailure &&
      error.code === "INSUFFICIENT_DISK_SPACE",
  );
  assert.equal(ffmpegSpawned, false);
});

test("classifyTranscodeStderr отличает отказ аудиокодека от отказа видеокодека", () => {
  const audioFailure = classifyTranscodeStderr(
    "[aac @ 0x0] Error while opening encoder for output stream #0:1 - maybe incorrect parameters",
    "h264_videotoolbox",
  );
  assert.equal(audioFailure.code, "AUDIO_ENCODER_FAILED");

  const videoFailure = classifyTranscodeStderr(
    "[h264_videotoolbox @ 0x0] Error while opening encoder for output stream #0:0 - maybe incorrect parameters",
    "h264_videotoolbox",
  );
  assert.equal(videoFailure.code, "VIDEO_ENCODER_FAILED");

  const macCompressionFailure = classifyTranscodeStderr(
    "Cannot create compression session: -12902",
    "h264_videotoolbox",
  );
  assert.equal(macCompressionFailure.code, "VIDEO_ENCODER_FAILED");

  const unrelatedFailure = classifyTranscodeStderr(
    "moov atom not found",
    "h264_videotoolbox",
  );
  assert.equal(unrelatedFailure.code, "TRANSCODE_FAILED");
});

test("normalizer сохраняет stderr ffmpeg в лог-каталог и называет его в ошибке", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "spectemus-normalized-media-"),
  );
  const logDirectory = await mkdtemp(join(tmpdir(), "spectemus-logs-"));
  const normalizer = new DesktopMediaNormalizer({
    ffmpegPath: "ffmpeg",
    ffprobePath: "ffprobe",
    logDirectory,
    outputDirectory: directory,
    platform: "darwin",
    spawnProcess: (command) => {
      if (command === "ffprobe") {
        const child = createChild();
        queueMicrotask(() => {
          child.stdout.emit(
            "data",
            JSON.stringify({
              format: { duration: "120", size: "1" },
              streams: [{ codec_type: "video", codec_name: "h264" }],
            }),
          );
          child.emit("close", 0);
        });
        return child;
      }
      const child = createChild();
      queueMicrotask(() => {
        child.stderr.emit(
          "data",
          "[aac @ 0x0] Error while opening encoder for output stream #0:1",
        );
        child.emit("close", 1);
      });
      return child;
    },
    statDiskSpace: async () => ({ bavail: 1_000_000, bsize: 1_000 }),
  });

  let error;
  try {
    await normalizer.normalize({ inputPath: "/private/movie.mkv" });
    assert.fail("normalize() должен был отклонить промис");
  } catch (thrown) {
    error = thrown;
  }
  assert.ok(error instanceof MediaNormalizationFailure);
  assert.equal(error.code, "AUDIO_ENCODER_FAILED");
  assert.match(error.message, /Диагностика: /);

  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  const logFiles = await readdir(logDirectory);
  assert.equal(logFiles.length, 1);
  const logContent = await readFile(join(logDirectory, logFiles[0]), "utf8");
  assert.match(logContent, /output stream #0:1/);
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
