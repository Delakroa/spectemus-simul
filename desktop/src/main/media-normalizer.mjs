import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const OUTPUT_VIDEO_CODEC = "h264";
const OUTPUT_AUDIO_CODEC = "aac";
const OUTPUT_AUDIO_BITRATE = "160k";
const OUTPUT_VIDEO_BITRATE = "6000k";
const FORCE_KILL_WAIT_MS = 1_000;
const PROBE_TIMEOUT_MS = 15_000;

export class MediaNormalizationFailure extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "MediaNormalizationFailure";
  }
}

export class DesktopMediaNormalizer {
  constructor({
    ffmpegPath,
    ffprobePath,
    outputDirectory,
    platform = process.platform,
    spawnProcess = spawn,
  }) {
    this.ffmpegPath = ffmpegPath;
    this.ffprobePath = ffprobePath;
    this.outputDirectory = resolve(outputDirectory);
    this.platform = platform;
    this.spawnProcess = spawnProcess;
  }

  async normalize({ inputPath, onProgress, signal }) {
    const sourcePath = resolve(inputPath);
    let outputPath;

    try {
      const source = await probeMedia({
        command: this.ffprobePath,
        inputPath: sourcePath,
        signal,
        spawnProcess: this.spawnProcess,
      });
      if (!source.video) {
        throw new MediaNormalizationFailure(
          "NO_VIDEO_STREAM",
          "В выбранном файле не найдена видеодорожка.",
        );
      }

      await mkdir(this.outputDirectory, { recursive: true, mode: 0o700 });
      outputPath = join(this.outputDirectory, `${randomUUID()}.mp4`);
      await runTranscode({
        command: this.ffmpegPath,
        args: buildNormalizationArguments({
          inputPath: sourcePath,
          outputPath,
          platform: this.platform,
        }),
        durationSeconds: source.durationSeconds,
        onProgress,
        signal,
        spawnProcess: this.spawnProcess,
      });
      const output = await probeMedia({
        command: this.ffprobePath,
        inputPath: outputPath,
        signal,
        spawnProcess: this.spawnProcess,
      });
      assertNormalizedOutput(output);
      const outputStats = await stat(outputPath);
      return {
        displayName: basename(sourcePath),
        durationSeconds: output.durationSeconds,
        outputPath,
        sizeBytes: outputStats.size,
      };
    } catch (error) {
      if (outputPath) {
        await rm(outputPath, { force: true }).catch(() => {});
      }
      throw normalizeFailure(error);
    }
  }
}

export async function clearNormalizedMediaDirectory(outputDirectory) {
  await rm(resolve(outputDirectory), { force: true, recursive: true });
}

export function buildNormalizationArguments({
  inputPath,
  outputPath,
  platform,
}) {
  return [
    "-hide_banner",
    "-nostdin",
    "-v",
    "error",
    "-progress",
    "pipe:1",
    "-y",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:v",
    resolveVideoEncoder(platform),
    "-b:v",
    OUTPUT_VIDEO_BITRATE,
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    OUTPUT_AUDIO_CODEC,
    "-b:a",
    OUTPUT_AUDIO_BITRATE,
    "-movflags",
    "+faststart",
    outputPath,
  ];
}

export function resolveVideoEncoder(platform) {
  if (platform === "darwin") {
    return "h264_videotoolbox";
  }
  if (platform === "win32") {
    return "h264_mf";
  }
  throw new MediaNormalizationFailure(
    "UNSUPPORTED_PLATFORM",
    "Локальная подготовка видео доступна только на macOS и Windows.",
  );
}

export function buildProbeArguments(inputPath) {
  return [
    "-v",
    "error",
    "-show_entries",
    "format=duration,size:stream=codec_type,codec_name",
    "-of",
    "json",
    inputPath,
  ];
}

export function parseMediaInventory(rawOutput) {
  let parsed;
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    throw new MediaNormalizationFailure(
      "PROBE_FAILED",
      "Не удалось определить кодеки выбранного видео.",
    );
  }
  if (!Array.isArray(parsed.streams) || !parsed.format) {
    throw new MediaNormalizationFailure(
      "PROBE_FAILED",
      "Не удалось определить кодеки выбранного видео.",
    );
  }

  return {
    audio:
      parsed.streams.find((stream) => stream.codec_type === "audio")
        ?.codec_name ?? null,
    durationSeconds: numberOrNull(parsed.format.duration),
    sizeBytes: numberOrNull(parsed.format.size),
    video:
      parsed.streams.find((stream) => stream.codec_type === "video")
        ?.codec_name ?? null,
  };
}

export function parseProgressLine(line, durationSeconds) {
  const [key, rawValue] = line.split("=", 2);
  if (key !== "out_time_us" || !durationSeconds || durationSeconds <= 0) {
    return null;
  }
  const outputMicroseconds = Number(rawValue);
  if (!Number.isFinite(outputMicroseconds) || outputMicroseconds < 0) {
    return null;
  }
  return Math.min(
    100,
    Math.max(
      0,
      Math.round((outputMicroseconds / 1_000_000 / durationSeconds) * 100),
    ),
  );
}

async function probeMedia({ command, inputPath, signal, spawnProcess }) {
  const output = await runCommand({
    command,
    args: buildProbeArguments(inputPath),
    label: "ffprobe",
    signal,
    spawnProcess,
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  return parseMediaInventory(output.stdout);
}

function runTranscode({
  command,
  args,
  durationSeconds,
  onProgress,
  signal,
  spawnProcess,
}) {
  return new Promise((resolvePromise, rejectPromise) => {
    let stderr = "";
    let stdoutBuffer = "";
    let settled = false;
    let cancelled = false;
    let child;
    let clearTerminationTimer = () => {};
    const finish = (callback) => {
      if (settled) {
        return;
      }
      settled = true;
      signal?.removeEventListener("abort", abort);
      clearTerminationTimer();
      callback();
    };
    const abort = () => {
      if (!child) {
        finish(() =>
          rejectPromise(
            new MediaNormalizationFailure(
              "CANCELLED",
              "Подготовка совместимой копии отменена.",
            ),
          ),
        );
        return;
      }
      cancelled = true;
      const termination = terminateProcess(child);
      if (termination.error) {
        finish(() => rejectPromise(termination.error));
        return;
      }
      clearTerminationTimer = termination.clearTimer;
    };

    if (signal?.aborted) {
      abort();
      return;
    }

    try {
      child = spawnProcess(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      finish(() => rejectPromise(error));
      return;
    }

    signal?.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => finish(() => rejectPromise(error)));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const progress = parseProgressLine(line, durationSeconds);
        if (progress !== null) {
          onProgress?.(progress);
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4_000);
    });
    child.once("close", (code) => {
      if (cancelled) {
        finish(() =>
          rejectPromise(
            new MediaNormalizationFailure(
              "CANCELLED",
              "Подготовка совместимой копии отменена.",
            ),
          ),
        );
        return;
      }
      if (code === 0) {
        onProgress?.(100);
        finish(resolvePromise);
        return;
      }
      finish(() =>
        rejectPromise(
          new MediaNormalizationFailure(
            "TRANSCODE_FAILED",
            describeTranscodeFailure(stderr),
          ),
        ),
      );
    });
  });
}

export function runCommand({
  command,
  args,
  label,
  signal,
  spawnProcess,
  forceKillWaitMs = FORCE_KILL_WAIT_MS,
  timeoutMs = PROBE_TIMEOUT_MS,
}) {
  return new Promise((resolvePromise, rejectPromise) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let cancelled = false;
    let timedOut = false;
    let child;
    let timeout;
    let clearTerminationTimer = () => {};
    const finish = (callback) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      clearTerminationTimer();
      signal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => {
      if (!child) {
        finish(() =>
          rejectPromise(
            new MediaNormalizationFailure(
              "CANCELLED",
              "Подготовка совместимой копии отменена.",
            ),
          ),
        );
        return;
      }
      cancelled = true;
      const termination = terminateProcess(child, forceKillWaitMs);
      if (termination.error) {
        finish(() => rejectPromise(termination.error));
        return;
      }
      clearTerminationTimer = termination.clearTimer;
    };

    if (signal?.aborted) {
      abort();
      return;
    }

    try {
      child = spawnProcess(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      finish(() => rejectPromise(error));
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    timeout = setTimeout(() => {
      timedOut = true;
      const termination = terminateProcess(child, forceKillWaitMs);
      if (termination.error) {
        finish(() => rejectPromise(termination.error));
        return;
      }
      clearTerminationTimer = termination.clearTimer;
    }, timeoutMs);
    timeout.unref?.();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4_000);
    });
    child.once("error", (error) => finish(() => rejectPromise(error)));
    child.once("close", (code) => {
      if (cancelled) {
        finish(() =>
          rejectPromise(
            new MediaNormalizationFailure(
              "CANCELLED",
              "Подготовка совместимой копии отменена.",
            ),
          ),
        );
        return;
      }
      if (timedOut) {
        finish(() =>
          rejectPromise(
            new MediaNormalizationFailure(
              "PROBE_FAILED",
              "Не удалось определить кодеки выбранного видео.",
            ),
          ),
        );
        return;
      }
      if (code === 0) {
        finish(() => resolvePromise({ stdout }));
        return;
      }
      finish(() =>
        rejectPromise(
          new Error(`${label} завершился с кодом ${code}: ${stderr.trim()}`),
        ),
      );
    });
  });
}

function terminateProcess(child, forceKillWaitMs = FORCE_KILL_WAIT_MS) {
  try {
    child.kill("SIGTERM");
  } catch (error) {
    return { clearTimer: () => {}, error };
  }
  const forceTimer = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // The process has already exited between termination signals.
    }
  }, forceKillWaitMs);
  forceTimer.unref?.();
  return {
    clearTimer: () => clearTimeout(forceTimer),
    error: null,
  };
}

function assertNormalizedOutput(inventory) {
  if (inventory.video !== OUTPUT_VIDEO_CODEC) {
    throw new MediaNormalizationFailure(
      "INVALID_OUTPUT",
      "Подготовленная копия не получила совместимую видеодорожку.",
    );
  }
  if (inventory.audio && inventory.audio !== OUTPUT_AUDIO_CODEC) {
    throw new MediaNormalizationFailure(
      "INVALID_OUTPUT",
      "Подготовленная копия не получила совместимую аудиодорожку.",
    );
  }
}

function normalizeFailure(error) {
  if (error instanceof MediaNormalizationFailure) {
    return error;
  }
  return new MediaNormalizationFailure(
    "TRANSCODE_FAILED",
    "Не удалось подготовить совместимую копию видео. Оригинальный файл не изменён.",
  );
}

function describeTranscodeFailure(stderr) {
  if (
    stderr.includes("Unknown encoder") ||
    stderr.includes("Cannot create compression session") ||
    stderr.includes("Error while opening encoder")
  ) {
    return "На этом компьютере сейчас недоступен встроенный H.264 видеокодер. Закройте приложения, использующие камеру или видео, и попробуйте снова.";
  }
  return "Не удалось подготовить совместимую копию видео. Оригинальный файл не изменён.";
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
