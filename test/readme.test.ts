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

describe("README", () => {
  const readme = readFileSync("README.md", "utf8");

  it.each(SECTIONS)("has a %s section", (title) => {
    expect(readme).toMatch(new RegExp(`^#{2,3} ${title}$`, "m"));
  });
});
