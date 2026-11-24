// Writes openapi/reseller-api.yaml from a source contract with prose keys stripped.
import { readFileSync, writeFileSync } from "node:fs";
import { parse, stringify } from "yaml";

const source = process.argv[2];
if (!source) {
  console.error("Usage: npm run sync-contract -- <path to source openapi.yaml>");
  process.exit(1);
}

const STRIP = new Set(["description", "summary", "example"]);

// Drops prose keys; a property that is merely named "description" holds an object and stays.
function strip(node) {
  if (Array.isArray(node)) return node.map(strip);
  if (node && typeof node === "object") {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (STRIP.has(key) && typeof value !== "object") continue;
      out[key] = strip(value);
    }
    // OpenAPI requires a description on every response object and redocly requires an operation summary.
    if (out.responses && typeof out.responses === "object") fillResponses(out.responses);
    if (out.operationId && !out.summary) out.summary = out.operationId;
    if (out.post?.responses && !out.post.summary) out.post.summary = "Webhook delivery";
    return out;
  }
  return node;
}

function fillResponses(responses) {
  for (const response of Object.values(responses)) {
    if (response && typeof response === "object" && !response.$ref && !response.description) {
      response.description = "Response";
    }
  }
}

const doc = strip(parse(readFileSync(source, "utf8")));
if (doc.components?.responses) fillResponses(doc.components.responses);
const date = new Date().toISOString().slice(0, 10);
const header = `# Reseller API contract, source version ${doc.info.version}, synced ${date}. Do not edit; run npm run sync-contract.\n`;
const body = stringify(doc, { lineWidth: 0 });
if (/[\u0400-\u04FF]/.test(body)) {
  const line = body.split("\n").find((l) => /[\u0400-\u04FF]/.test(l));
  console.error(`Cyrillic text remains in the contract: ${line?.trim()}`);
  process.exit(1);
}
writeFileSync(new URL("../openapi/reseller-api.yaml", import.meta.url), header + body);
