import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { VERSION } from "../src/index.js";

test("VERSION matches package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  expect(VERSION).toBe(pkg.version);
  expect(VERSION).toBe("0.1.0");
});
