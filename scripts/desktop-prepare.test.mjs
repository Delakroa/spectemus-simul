import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  prepareDesktopBuild,
  resolveDesktopBuildSettings,
} from "./desktop-prepare.mjs";

test("normal installer forces Internet flags off despite ambient Vite values", async () => {
  const root = await mkdtemp(join(tmpdir(), "spectemus-desktop-prepare-"));
  const calls = [];
  try {
    await prepareDesktopBuild({
      root,
      environment: {
        VITE_INTERNET_ROOM_RUNTIME_ENABLED: "true",
        VITE_INTERNET_APP_ORIGIN: "https://wrong.example.org",
        VITE_API_BASE_URL: "https://wrong.example.org",
        SPECTEMUS_PUBLIC_API_ORIGIN: "https://app.spectemus.org",
      },
      runCommand: async (command, args, options) =>
        calls.push({ command, args, options }),
    });
    assert.equal(calls.length, 2);
    assert.equal(
      calls[0].options.env.VITE_INTERNET_ROOM_RUNTIME_ENABLED,
      "false",
    );
    assert.equal(calls[0].options.env.VITE_INTERNET_APP_ORIGIN, "");
    assert.equal(calls[0].options.env.VITE_API_BASE_URL, "");
    assert.deepEqual(
      JSON.parse(
        await readFile(
          join(root, "desktop/.sidecars/public-build-config.json"),
        ),
      ),
      { schemaVersion: 1, internetModeEnabled: false, publicApiOrigin: null },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("opt-in installer gives frontend and main the same canonical HTTPS origin", async () => {
  const root = await mkdtemp(join(tmpdir(), "spectemus-desktop-prepare-"));
  const calls = [];
  try {
    await prepareDesktopBuild({
      root,
      environment: {
        SPECTEMUS_PUBLIC_BUILD_ENABLED: "true",
        SPECTEMUS_PUBLIC_API_ORIGIN: "https://app.spectemus.org/",
      },
      runCommand: async (command, args, options) =>
        calls.push({ command, args, options }),
    });
    assert.equal(
      calls[0].options.env.VITE_INTERNET_ROOM_RUNTIME_ENABLED,
      "true",
    );
    assert.equal(
      calls[0].options.env.VITE_INTERNET_APP_ORIGIN,
      "https://app.spectemus.org",
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(
          join(root, "desktop/.sidecars/public-build-config.json"),
        ),
      ),
      {
        schemaVersion: 1,
        internetModeEnabled: true,
        publicApiOrigin: "https://app.spectemus.org",
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid public origin rejects before running build commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "spectemus-desktop-prepare-"));
  let calls = 0;
  try {
    await assert.rejects(
      () =>
        prepareDesktopBuild({
          root,
          environment: {
            SPECTEMUS_PUBLIC_BUILD_ENABLED: "true",
            SPECTEMUS_PUBLIC_API_ORIGIN: "http://127.0.0.1:8088",
          },
          runCommand: async () => calls++,
        }),
      /public https/,
    );
    assert.equal(calls, 0);
    assert.throws(
      () =>
        resolveDesktopBuildSettings({
          SPECTEMUS_PUBLIC_BUILD_ENABLED: "true",
          SPECTEMUS_PUBLIC_API_ORIGIN: "https://app.example.test",
        }),
      /реальный публичный домен/,
    );
    assert.throws(
      () =>
        resolveDesktopBuildSettings({
          SPECTEMUS_PUBLIC_BUILD_ENABLED: "true",
          SPECTEMUS_PUBLIC_API_ORIGIN: "https://app.example.com",
        }),
      /реальный публичный домен/,
    );
    assert.throws(
      () =>
        resolveDesktopBuildSettings({
          SPECTEMUS_PUBLIC_BUILD_ENABLED: "true",
          SPECTEMUS_PUBLIC_API_ORIGIN: "https://intranet",
        }),
      /реальный публичный домен/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed build leaves no stale public config for a later package", async () => {
  const root = await mkdtemp(join(tmpdir(), "spectemus-desktop-prepare-"));
  try {
    await prepareDesktopBuild({
      root,
      environment: {},
      runCommand: async () => {},
    });
    await assert.rejects(
      () =>
        prepareDesktopBuild({
          root,
          environment: {
            SPECTEMUS_PUBLIC_BUILD_ENABLED: "true",
            SPECTEMUS_PUBLIC_API_ORIGIN: "https://app.spectemus.org",
          },
          runCommand: async () => {
            throw new Error("build stopped");
          },
        }),
      /build stopped/,
    );
    await assert.rejects(
      () => readFile(join(root, "desktop/.sidecars/public-build-config.json")),
      {
        code: "ENOENT",
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
