const platform = readPlatform(process.argv.slice(2));
const required =
  platform === "mac"
    ? [
        "CSC_LINK",
        "CSC_KEY_PASSWORD",
        "APPLE_ID",
        "APPLE_APP_SPECIFIC_PASSWORD",
        "APPLE_TEAM_ID",
      ]
    : ["WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD"];
const missing = required.filter((name) => !process.env[name]?.trim());

if (missing.length > 0) {
  throw new Error(
    `Signed ${platform} installer нельзя собрать без: ${missing.join(", ")}. Используйте preview command только для install smoke.`,
  );
}

console.log(`[ok] Signing credentials для ${platform} packaging переданы.`);

function readPlatform(args) {
  if (
    args.length !== 2 ||
    args[0] !== "--platform" ||
    !["mac", "win"].includes(args[1])
  ) {
    throw new Error(
      "Использование: node scripts/desktop-signing-preflight.mjs --platform <mac|win>",
    );
  }
  return args[1];
}
