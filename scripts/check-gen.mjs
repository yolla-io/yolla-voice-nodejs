// Fails when src/generated/openapi.ts is not what openapi-typescript produces from the contract copy.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "check-gen-"));
const out = join(dir, "openapi.ts");
try {
  execFileSync(
    "npx",
    [
      "openapi-typescript",
      "openapi/partner-api.yaml",
      "--default-non-nullable",
      "false",
      "-o",
      out,
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  const fresh = readFileSync(out, "utf8");
  const committed = readFileSync("src/generated/openapi.ts", "utf8");
  if (fresh !== committed) {
    console.error("Generated types are stale: run npm run gen");
    process.exit(1);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
