import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  recoverOwnedSidecars,
  writeOwnedSidecars,
} from "./owned-processes.mjs";

test("очищает только процесс с подтверждённой командой Spectemus", async () => {
  const runtimeDirectory = await mkdtemp(join(tmpdir(), "spectemus-owned-"));
  const terminated = [];
  try {
    await writeOwnedSidecars({
      runtimeDirectory,
      processes: [
        {
          name: "Backend",
          pid: 101,
          commandIncludes: ["backend.jar", "--server.port=8080"],
        },
        {
          name: "LiveKit",
          pid: 102,
          commandIncludes: ["livekit", "livekit.yaml"],
        },
      ],
    });
    const recovered = await recoverOwnedSidecars({
      runtimeDirectory,
      inspectCommand: async (pid) =>
        pid === 101
          ? "java -jar backend.jar --server.port=8080"
          : "unrelated process",
      terminate: async (pid) => terminated.push(pid),
      waitForExit: async () => {},
    });
    assert.deepEqual(recovered, ["Backend"]);
    assert.deepEqual(terminated, [101]);
    assert.deepEqual(await readdir(runtimeDirectory), []);
  } finally {
    await rm(runtimeDirectory, { force: true, recursive: true });
  }
});

test("эскалирует восстановление старого sidecar до SIGKILL", async () => {
  const runtimeDirectory = await mkdtemp(join(tmpdir(), "spectemus-owned-"));
  const signals = [];
  try {
    await writeOwnedSidecars({
      runtimeDirectory,
      processes: [
        {
          name: "Backend",
          pid: 101,
          commandIncludes: ["backend.jar", "--server.port=8080"],
        },
      ],
    });

    const recovered = await recoverOwnedSidecars({
      forceKillWaitMs: 1,
      gracefulShutdownWaitMs: 1,
      inspectCommand: async () => "java -jar backend.jar --server.port=8080",
      runtimeDirectory,
      terminate: async (_pid, signal) => signals.push(signal),
      waitForExit: async () => {
        if (signals.at(-1) === "SIGTERM") {
          throw new Error("Spring Boot ещё завершает работу");
        }
      },
    });

    assert.deepEqual(recovered, ["Backend"]);
    assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
    assert.deepEqual(await readdir(runtimeDirectory), []);
  } finally {
    await rm(runtimeDirectory, { force: true, recursive: true });
  }
});
