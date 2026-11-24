// Public-repo guard: fails when a tracked file holds internal or non-English text.
// The repo is mirrored to public GitHub. This script holds the patterns itself, so it is skipped.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const FORBIDDEN = [
  ["internal host", /etservice/i],
  ["wiki link", /confluence/i],
  ["wiki vendor", /atlassian/i],
  ["internal email", /@yollacalls\.com/i],
  ["local dev URL", /localhost:8080/],
  ["Cyrillic text", /\p{Script=Cyrillic}/u],
];

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((f) => f && f !== "scripts/check-public.mjs");

let failed = false;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const [name, re] of FORBIDDEN) {
    if (re.test(text)) {
      console.error(`${file}: ${name}`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
console.log(`Public-repo guard: ${files.length} tracked files clean`);
