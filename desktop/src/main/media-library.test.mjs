import assert from "node:assert/strict";
import { existsSync } from "node:fs";
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

test("media library не копит копии, если renderer потерял свой id", async () => {
  const directory = await mkdtemp(join(tmpdir(), "spectemus-media-orphan-"));
  const source = join(directory, "film.mkv");
  const firstOutput = join(directory, "first.mp4");
  const secondOutput = join(directory, "second.mp4");
  await writeFile(source, "movie");
  await writeFile(firstOutput, "normalized");
  await writeFile(secondOutput, "normalized");

  let nextOutput = firstOutput;
  const library = new DesktopMediaLibrary({
    normalizer: { normalize: async () => ({ outputPath: nextOutput }) },
  });

  const first = await library.registerSource(source);
  await library.normalize(first.id);
  assert.equal(existsSync(firstOutput), true);

  // Перезагрузка страницы: renderer забыл id и не может освободить запись сам,
  // поэтому следующий выбор файла обязан освободить её за него.
  nextOutput = secondOutput;
  const second = await library.registerSource(source);
  await library.normalize(second.id);

  assert.equal(
    existsSync(firstOutput),
    false,
    "первая копия должна быть удалена",
  );
  assert.equal(existsSync(secondOutput), true);
  assert.equal(library.resolveForPlayback(first.id), null);
});

test("media library переживает сбой удаления временной копии", async () => {
  const directory = await mkdtemp(join(tmpdir(), "spectemus-media-unlink-"));
  const source = join(directory, "film.mkv");
  await writeFile(source, "movie");
  const library = new DesktopMediaLibrary({
    // Каталог вместо файла даёт реальную ошибку удаления, как открытый хендл на Windows.
    normalizer: { normalize: async () => ({ outputPath: directory }) },
  });

  const selection = await library.registerSource(source);
  await library.normalize(selection.id);

  // Сбой удаления не должен превращаться в исключение: запись всё равно освобождается,
  // а файл подметёт свип при следующем запуске.
  await library.release(selection.id);
  assert.equal(library.resolveForPlayback(selection.id), null);
});
