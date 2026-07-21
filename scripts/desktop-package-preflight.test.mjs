import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = join(process.cwd(), "scripts", "desktop-package-preflight.mjs");

test("preflight отклоняет неизвестную platform до проверки файлов", () => {
  const result = spawnSync(process.execPath, [script, "--platform", "linux"], {
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /mac\|win/);
});

test("preflight сообщает какой packaging input отсутствует", async () => {
  const emptyRoot = await mkdtemp(join(tmpdir(), "spectemus-preflight-"));
  try {
    const result = spawnSync(process.execPath, [script, "--platform", "mac"], {
      cwd: emptyRoot,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /не подготовлен/);
  } finally {
    await rm(emptyRoot, { recursive: true, force: true });
  }
});
