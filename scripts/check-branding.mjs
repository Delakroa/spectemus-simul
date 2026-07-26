import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const migrationRecord = "docs/WT-665_COMPLETE_SPECTEMUS_RENAME.md";
const legacyPatterns = [
  new RegExp(["watch", "[-_ ]?", "together"].join(""), "i"),
  new RegExp(["watch", "together"].join(""), "i"),
];

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean)
  .filter((filePath) => filePath !== migrationRecord);

const findings = [];
for (const filePath of trackedFiles) {
  if (matchesLegacyName(filePath)) {
    findings.push(`${filePath}: legacy product name in path`);
    continue;
  }

  const content = readFileSync(filePath);
  if (content.includes(0)) {
    continue;
  }

  const text = content.toString("utf8");
  if (matchesLegacyName(text)) {
    findings.push(`${filePath}: legacy product name in content`);
  }
}

if (findings.length > 0) {
  throw new Error(
    `Ребрендинг не завершён:\n${findings.map((finding) => `- ${finding}`).join("\n")}`,
  );
}

console.log("[ok] Spectemus Simul branding");

function matchesLegacyName(value) {
  return legacyPatterns.some((pattern) => pattern.test(value));
}
