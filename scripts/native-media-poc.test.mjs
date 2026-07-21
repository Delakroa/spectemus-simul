import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = join(process.cwd(), "scripts", "native-media-poc.mjs");
const probeOutput = JSON.stringify({
  format: { duration: "3", format_name: "mov,mp4,m4a,3gp,3g2,mj2", size: "42" },
  streams: [
    { codec_name: "h264", codec_type: "video", height: 360, width: 640 },
    { channels: 2, codec_name: "aac", codec_type: "audio" },
  ],
});

test("harness передаёт input/output в ffmpeg и проверяет нормализованный output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "spectemus-native-poc-"));
  const input = join(directory, "input.mkv");
  const output = join(directory, "output.mp4");
  const ffprobe = join(directory, "ffprobe");
  const ffmpeg = join(directory, "ffmpeg");
  try {
    await writeFile(input, "fixture");
    await writeExecutable(
      ffprobe,
      `#!/usr/bin/env node\nconsole.log('${probeOutput}')\n`,
    );
    await writeExecutable(
      ffmpeg,
      "#!/usr/bin/env node\nconst { writeFileSync } = require('node:fs');\nwriteFileSync(process.argv.at(-1), 'normalized');\n",
    );
    const result = spawnSync(
      process.execPath,
      [
        script,
        "--ffprobe",
        ffprobe,
        "--ffmpeg",
        ffmpeg,
        "--input",
        input,
        "--transcode",
        "--output",
        output,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.transcoded, true);
    assert.equal(report.output.video.codec, "h264");
    assert.equal(report.output.audio.codec, "aac");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function writeExecutable(path, content) {
  await writeFile(path, content);
  await chmod(path, 0o755);
}
