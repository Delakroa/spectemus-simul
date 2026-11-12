import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { assertPublicHttpsOrigin } from "./device-binding.mjs";

export const PUBLIC_BUILD_CONFIG_NAME = "public-build-config.json";

export function createPublicBuildConfig({ enabled, rawOrigin } = {}) {
  return enabled
    ? {
        schemaVersion: 1,
        internetModeEnabled: true,
        publicApiOrigin: assertPublicHttpsOrigin(rawOrigin),
      }
    : {
        schemaVersion: 1,
        internetModeEnabled: false,
        publicApiOrigin: null,
      };
}

export function parsePublicBuildConfig(raw) {
  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    throw new Error("Invalid desktop public build config");
  }
  if (
    !config ||
    typeof config !== "object" ||
    Array.isArray(config) ||
    config.schemaVersion !== 1 ||
    typeof config.internetModeEnabled !== "boolean" ||
    Object.keys(config).sort().join(",") !==
      "internetModeEnabled,publicApiOrigin,schemaVersion"
  ) {
    throw new Error("Invalid desktop public build config");
  }
  if (!config.internetModeEnabled) {
    if (config.publicApiOrigin !== null) {
      throw new Error("Disabled desktop build must not contain an origin");
    }
    return createPublicBuildConfig();
  }
  const normalized = assertPublicHttpsOrigin(config.publicApiOrigin);
  if (normalized !== config.publicApiOrigin) {
    throw new Error("Desktop public build origin is not canonical");
  }
  return createPublicBuildConfig({ enabled: true, rawOrigin: normalized });
}

export async function loadPublicBuildConfig({
  packaged,
  resourcesPath,
  environment,
}) {
  if (!packaged) {
    return createPublicBuildConfig({
      enabled: Boolean(environment?.SPECTEMUS_PUBLIC_API_ORIGIN),
      rawOrigin: environment?.SPECTEMUS_PUBLIC_API_ORIGIN,
    });
  }
  try {
    return parsePublicBuildConfig(
      await readFile(join(resourcesPath, PUBLIC_BUILD_CONFIG_NAME), "utf8"),
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      return createPublicBuildConfig();
    }
    throw error;
  }
}
