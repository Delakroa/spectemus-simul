export const POC_PROFILES = {
  "poc-libx264-aac": {
    description:
      "Только для измерений; требует FFmpeg с libx264 и не является release profile.",
    videoArguments: [
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
    ],
  },
};

export function buildProbeArguments(inputPath) {
  return [
    "-v",
    "error",
    "-show_entries",
    "format=format_name,duration,size:stream=index,codec_type,codec_name,width,height,channels,bit_rate",
    "-of",
    "json",
    inputPath,
  ];
}

export function parseProbeOutput(rawOutput) {
  let result;
  try {
    result = JSON.parse(rawOutput);
  } catch {
    throw new Error("ffprobe вернул невалидный JSON.");
  }
  if (!Array.isArray(result.streams) || !result.format) {
    throw new Error("ffprobe не вернул streams и format.");
  }
  const video = result.streams.find((stream) => stream.codec_type === "video");
  if (!video?.codec_name) {
    throw new Error("В файле не найден video stream.");
  }
  const audio = result.streams.find((stream) => stream.codec_type === "audio");
  return {
    audio: audio
      ? {
          channels: numberOrNull(audio.channels),
          codec: audio.codec_name ?? "unknown",
        }
      : null,
    container: result.format.format_name ?? "unknown",
    durationSeconds: numberOrNull(result.format.duration),
    sizeBytes: numberOrNull(result.format.size),
    video: {
      codec: video.codec_name,
      height: numberOrNull(video.height),
      width: numberOrNull(video.width),
    },
  };
}

export function buildTranscodeArguments({ inputPath, outputPath, profile }) {
  const selected = POC_PROFILES[profile];
  if (!selected) {
    throw new Error(`Неизвестный POC profile: ${profile}.`);
  }
  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    ...selected.videoArguments,
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    outputPath,
  ];
}

export function assertNormalizedOutput(inventory) {
  if (inventory.video.codec !== "h264") {
    throw new Error(
      `POC output должен быть H.264, получен ${inventory.video.codec}.`,
    );
  }
  if (inventory.audio && inventory.audio.codec !== "aac") {
    throw new Error(
      `POC output с audio должен быть AAC, получен ${inventory.audio.codec}.`,
    );
  }
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
