import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const script = join(process.cwd(), "scripts", "desktop-sidecars-stage.mjs");

test("staging разворачивает symbolic links до packaging", async () => {
  const root = await mkdtemp(join(tmpdir(), "spectemus-sidecars-stage-"));
  const runtime = join(root, "runtime");
  const livekit = join(root, "livekit-server");
  const media = join(root, "media");
  const stagingRoot = join(root, "staging-project");
  try {
    await createExecutable(
      runtime,
      "bin/java",
      "echo 'openjdk version \"25.0.1\"'\n",
    );
    await symlink("java", join(runtime, "bin", "java-copy"));
    await createExecutable(root, "livekit-server");
    await createExecutable(media, "bin/ffmpeg");
    await createExecutable(media, "bin/ffprobe");
    await symlink("ffmpeg", join(media, "bin", "ffmpeg-copy"));
    await mkdir(stagingRoot, { recursive: true });

    const result = spawnSync(
      process.execPath,
      [script, "--runtime", runtime, "--livekit", livekit, "--media", media],
      { cwd: stagingRoot, encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      (
        await lstat(
          join(stagingRoot, "desktop/.sidecars/runtime/bin/java-copy"),
        )
      ).isSymbolicLink(),
      false,
    );
    assert.equal(
      (
        await lstat(
          join(stagingRoot, "desktop/.sidecars/media/bin/ffmpeg-copy"),
        )
      ).isSymbolicLink(),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function createExecutable(root, relativePath, body = "exit 0\n") {
  const filePath = join(root, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `#!/bin/sh\n${body}`);
  await chmod(filePath, 0o755);
}
