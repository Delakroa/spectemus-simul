import { spawnSync } from "node:child_process";
import { access, constants, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

import {
  POC_PROFILES,
  assertNormalizedOutput,
  buildProbeArguments,
  buildTranscodeArguments,
  parseProbeOutput,
} from "./native-media-poc-core.mjs";

const options = parseOptions(process.argv.slice(2));
await assertExecutable(options.ffprobe, "ffprobe");
await assertReadable(options.input, "input file");

const source = probe(options.ffprobe, options.input);
const report = {
  input: source,
  profile: options.profile,
  recommendation:
    "Не добавлять native transcoding в desktop installer до полного evidence и license review.",
  transcoded: false,
};

if (options.transcode) {
  await assertExecutable(options.ffmpeg, "ffmpeg");
  const startedAt = performance.now();
  run(
    options.ffmpeg,
    buildTranscodeArguments({
      inputPath: options.input,
      outputPath: options.output,
      profile: options.profile,
    }),
    "ffmpeg transcode",
  );
  const output = probe(options.ffprobe, options.output);
  assertNormalizedOutput(output);
  const outputStats = await stat(options.output);
  report.output = output;
  report.output.sizeBytes = outputStats.size;
  report.transcoded = true;
  report.wallClockSeconds = Number(
    ((performance.now() - startedAt) / 1_000).toFixed(3),
  );
}

console.log(JSON.stringify(report, null, 2));

function parseOptions(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (key === "--transcode") {
      if (values.has(key)) {
        throw new Error("--transcode передан повторно.");
      }
      values.set(key, true);
      index -= 1;
      continue;
    }
    if (!key?.startsWith("--") || !value || values.has(key)) {
      throw new Error(usage());
    }
    values.set(key, value);
  }
  const ffprobe = values.get("--ffprobe");
  const input = values.get("--input");
  const transcode = values.has("--transcode");
  const ffmpeg = values.get("--ffmpeg");
  const output = values.get("--output");
  const profile = values.get("--profile") ?? "poc-libx264-aac";
  if (!ffprobe || !input || (transcode && (!ffmpeg || !output))) {
    throw new Error(usage());
  }
  if (!POC_PROFILES[profile]) {
    throw new Error(`${usage()} Неизвестный profile: ${profile}.`);
  }
  if (transcode && !output.toLowerCase().endsWith(".mp4")) {
    throw new Error("POC output должен иметь расширение .mp4.");
  }
  return {
    ffmpeg: ffmpeg ? resolve(ffmpeg) : undefined,
    ffprobe: resolve(ffprobe),
    input: resolve(input),
    output: output ? resolve(output) : undefined,
    profile,
    transcode,
  };
}

function probe(ffprobe, input) {
  return parseProbeOutput(run(ffprobe, buildProbeArguments(input), "ffprobe"));
}

function run(command, args, label) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) {
    throw new Error(`${label} не запустился: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `${label} завершился с кодом ${result.status}: ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

async function assertReadable(filePath, label) {
  try {
    await access(filePath, constants.R_OK);
  } catch {
    throw new Error(`${label} не найден: ${filePath}`);
  }
}

async function assertExecutable(filePath, label) {
  try {
    await access(filePath, constants.X_OK);
  } catch {
    throw new Error(`${label} не найден или не исполняемый: ${filePath}`);
  }
}

function usage() {
  return "Использование: node scripts/native-media-poc.mjs --ffprobe <path> --input <file> [--transcode --ffmpeg <path> --output <file.mp4> --profile poc-libx264-aac]";
}
