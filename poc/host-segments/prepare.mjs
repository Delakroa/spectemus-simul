import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const CHUNK_BYTES = 64 * 1024;

export function inspectMovie(raw) {
  const data = JSON.parse(raw);
  const video = data.streams?.find((stream) => stream.codec_type === "video");
  const audio = data.streams?.find((stream) => stream.codec_type === "audio");
  const duration = Number(data.format?.duration);
  if (
    video?.codec_name !== "h264" ||
    video.pix_fmt !== "yuv420p" ||
    (audio && (audio.codec_name !== "aac" || audio.profile !== "LC")) ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    throw new Error(
      "PoC принимает только H.264 8-bit yuv420p и AAC-LC (или видео без звука). Конвертация здесь не выполняется.",
    );
  }
  return { video, audio, duration };
}

export function movieMime(inventory) {
  const hex = (inventory.video.extradata ?? "")
    .split("\n")
    .filter((line) => /^\s*[0-9a-f]{8}:/i.test(line))
    .map((line) =>
      line
        .replace(/^\s*[0-9a-f]{8}:\s*/i, "")
        .split(/\s{2,}/)[0]
        .replace(/\s/g, ""),
    )
    .join("");
  if (!/^01[0-9a-f]{6}/i.test(hex))
    throw new Error("Не найден AVC configuration record в подготовленном MP4.");
  return `video/mp4; codecs="avc1.${hex.slice(2, 8).toUpperCase()}${inventory.audio ? ", mp4a.40.2" : ""}"`;
}

export function remuxArguments(input, output) {
  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-n",
    "-i",
    resolve(input),
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-sn",
    "-dn",
    "-map_metadata",
    "-1",
    "-c",
    "copy",
    "-avoid_negative_ts",
    "make_zero",
    "-movflags",
    "+empty_moov+default_base_moof+frag_keyframe",
    "-frag_duration",
    "2000000",
    output,
  ];
}

export async function run(command, args, timeoutMs = 15_000) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const output = [];
    let length = 0;
    let failed = false;
    const fail = () => {
      failed = true;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(fail, timeoutMs);
    child.stdout.on("data", (data) => {
      length += data.length;
      if (length > 2_000_000) fail();
      else output.push(data);
    });
    child.stderr.resume(); // Не выводим stderr: он может содержать путь к фильму.
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("Не удалось запустить media tool."));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (failed || code !== 0)
        reject(
          new Error(
            "Media tool остановлен по ошибке, лимиту вывода или таймауту.",
          ),
        );
      else resolveRun(Buffer.concat(output).toString("utf8"));
    });
  });
}

async function probe(ffprobe, input) {
  return inspectMovie(
    await run(ffprobe, [
      "-v",
      "error",
      "-show_data",
      "-show_entries",
      "stream=codec_type,codec_name,profile,pix_fmt,extradata:format=duration",
      "-of",
      "json",
      input,
    ]),
  );
}

export async function prepareMovie({
  input,
  ffmpeg = "ffmpeg",
  ffprobe = "ffprobe",
}) {
  const directory = await mkdtemp(join(tmpdir(), "spectemus-segments-"));
  const mediaPath = join(directory, "movie.mp4");
  try {
    await probe(ffprobe, resolve(input));
    const started = performance.now();
    await run(ffmpeg, remuxArguments(input, mediaPath), 120_000);
    const inventory = await probe(ffprobe, mediaPath);
    const size = (await stat(mediaPath)).size;
    if (!Number.isSafeInteger(size) || size <= 0)
      throw new Error("Подготовленный файл пуст или слишком велик.");
    return {
      mediaPath,
      manifest: {
        version: 1,
        mime: movieMime(inventory),
        size,
        duration: inventory.duration,
        chunkBytes: CHUNK_BYTES,
      },
      preparation: {
        mode: "stream-copy",
        elapsedMs: Math.round(performance.now() - started),
        sizeBytes: size,
      },
      dispose: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
