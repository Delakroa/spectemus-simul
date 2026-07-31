import { randomUUID } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

function normalizedName(fileName) {
  const lastDot = fileName.lastIndexOf(".");
  const stem = lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
  return `${stem}.mp4`;
}

export class DesktopMediaLibrary {
  constructor({ normalizer = null } = {}) {
    this.normalizer = normalizer;
    this.entries = new Map();
    this.running = new Map();
  }

  async registerSource(filePath) {
    const sourcePath = resolve(filePath);
    const sourceStat = await stat(sourcePath);
    if (!sourceStat.isFile()) {
      throw new Error("Выберите обычный видеофайл.");
    }
    const id = randomUUID();
    this.entries.set(id, {
      displayName: basename(sourcePath),
      normalizedPath: null,
      playbackName: basename(sourcePath),
      sourcePath,
    });
    return this.describe(id);
  }

  describe(id) {
    const entry = this.entries.get(id);
    if (!entry) {
      throw new Error("Выбранный файл больше недоступен. Выберите его заново.");
    }
    return {
      displayName: entry.displayName,
      id,
      isNormalized: Boolean(entry.normalizedPath),
      playbackName: entry.playbackName,
    };
  }

  resolveForPlayback(id) {
    const entry = this.entries.get(id);
    if (!entry) {
      return null;
    }
    return {
      displayName: entry.playbackName,
      filePath: entry.normalizedPath ?? entry.sourcePath,
    };
  }

  async normalize(id, onProgress) {
    const entry = this.entries.get(id);
    if (!entry) {
      throw new Error("Выбранный файл больше недоступен. Выберите его заново.");
    }
    if (!this.normalizer) {
      throw new Error("В этой сборке нет средства подготовки видео.");
    }
    if (entry.normalizedPath) {
      return this.describe(id);
    }
    if (this.running.has(id)) {
      return this.running.get(id).promise;
    }

    const controller = new AbortController();
    const promise = this.normalizer
      .normalize({
        inputPath: entry.sourcePath,
        onProgress,
        signal: controller.signal,
      })
      .then(async ({ outputPath }) => {
        const current = this.entries.get(id);
        if (!current) {
          await rm(outputPath, { force: true });
          throw new Error("Подготовка отменена.");
        }
        current.normalizedPath = outputPath;
        current.playbackName = normalizedName(current.displayName);
        return this.describe(id);
      })
      .finally(() => this.running.delete(id));
    this.running.set(id, { controller, promise });
    return promise;
  }

  cancel(id) {
    const running = this.running.get(id);
    if (running) {
      running.controller.abort();
    }
  }

  async release(id) {
    const running = this.running.get(id);
    if (running) {
      running.controller.abort();
      await running.promise.catch(() => {});
    }
    const entry = this.entries.get(id);
    this.entries.delete(id);
    if (entry?.normalizedPath) {
      await rm(entry.normalizedPath, { force: true });
    }
  }

  async clear() {
    await Promise.all([...this.entries.keys()].map((id) => this.release(id)));
  }
}
