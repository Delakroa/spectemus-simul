import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DesktopMediaLibrary } from "./media-library.mjs";

test("media library не раскрывает путь selected file renderer-у", async () => {
  const directory = await mkdtemp(join(tmpdir(), "spectemus-media-library-"));
  const source = join(directory, "private-film.mkv");
  await writeFile(source, "movie");
  const library = new DesktopMediaLibrary();

  const selection = await library.registerSource(source);

  assert.equal(selection.displayName, "private-film.mkv");
  assert.equal(selection.isNormalized, false);
  assert.equal("filePath" in selection, false);
  assert.equal(library.resolveForPlayback(selection.id)?.filePath, source);
});

test("media library заменяет только playback copy и удаляет её после release", async () => {
  const directory = await mkdtemp(join(tmpdir(), "spectemus-media-library-"));
  const source = join(directory, "private-film.mkv");
  const output = join(directory, "temporary.mp4");
  await writeFile(source, "movie");
  await writeFile(output, "normalized");
  const normalizer = {
    normalize: async () => ({ outputPath: output }),
  };
  const library = new DesktopMediaLibrary({ normalizer });
  const selection = await library.registerSource(source);

  const normalized = await library.normalize(selection.id);
  assert.equal(normalized.isNormalized, true);
  assert.equal(library.resolveForPlayback(selection.id)?.filePath, output);
  await library.release(selection.id);
  assert.equal(library.resolveForPlayback(selection.id), null);
  await assert.rejects(() =>
    import("node:fs/promises").then(({ stat }) => stat(output)),
  );
});

test("media library дожидается отмены подготовки перед освобождением файла", async () => {
  const directory = await mkdtemp(join(tmpdir(), "spectemus-media-library-"));
  const source = join(directory, "private-film.mkv");
  await writeFile(source, "movie");
  let wasCancelled = false;
  const normalizer = {
    normalize: ({ signal }) =>
      new Promise((_, rejectPromise) => {
        signal.addEventListener(
          "abort",
          () => {
            wasCancelled = true;
            rejectPromise(new Error("cancelled"));
          },
          { once: true },
        );
      }),
  };
  const library = new DesktopMediaLibrary({ normalizer });
  const selection = await library.registerSource(source);
  const normalizing = library.normalize(selection.id);

  await library.release(selection.id);

  assert.equal(wasCancelled, true);
  await assert.rejects(normalizing, /cancelled/);
  assert.equal(library.resolveForPlayback(selection.id), null);
});
