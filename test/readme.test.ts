import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SECTIONS = [
  "Installation",
  "Quick start",
  "Configuration",
  "Calls",
  "Pagination",
  "Errors",
  "Retries and idempotency",
  "Webhooks",
  "Testing webhooks",
  "Requirements",
  "Versioning",
];

// Public-repo guard: this file itself holds the forbidden strings, so it is skipped.
const FORBIDDEN: [string, RegExp][] = [
  ["internal host", /etservice/i],
  ["wiki link", /confluence/i],
  ["wiki vendor", /atlassian/i],
  ["internal email", /@yollacalls\.com/i],
  ["local dev URL", /localhost:8080/],
  ["Cyrillic text", /\p{Script=Cyrillic}/u],
];

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .filter((f) => !f.startsWith("openapi/") && f !== "test/readme.test.ts");
}

describe("README", () => {
  const readme = readFileSync("README.md", "utf8");

  it.each(SECTIONS)("has a %s section", (title) => {
    expect(readme).toMatch(new RegExp(`^#{2,3} ${title}$`, "m"));
  });
});

describe("public repo guard", () => {
  it.each(FORBIDDEN)("no %s in tracked files", (_name, re) => {
    const hits = trackedFiles().filter((f) => re.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
