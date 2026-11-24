// Writes openapi/reseller-api.yaml from a source contract with prose keys stripped.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parse, stringify } from "yaml";

const source = process.argv[2];
if (!source) {
  console.error("Usage: npm run sync-contract -- <path to source openapi.yaml>");
  process.exit(1);
}

// Prose, examples and internal planning metadata. All of them are dropped wherever they appear,
// except as keys of `properties`, where a key is a field name.
const STRIP = new Set(["description", "summary", "example", "examples", "x-mvp"]);

function strip(node, parentKey) {
  if (Array.isArray(node)) return node.map((item) => strip(item));
  if (node && typeof node === "object") {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (parentKey !== "properties" && STRIP.has(key)) continue;
      out[key] = strip(value, key);
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
const commit = sourceCommit(source);
const header = `# Reseller API contract, source version ${doc.info.version}, commit ${commit}, synced ${date}. Do not edit; run npm run sync-contract.\n`;
const body = stringify(doc, { lineWidth: 0 });
if (/[\u0400-\u04FF]/.test(body)) {
  const line = body.split("\n").find((l) => /[\u0400-\u04FF]/.test(l));
  console.error(`Cyrillic text remains in the contract: ${line?.trim()}`);
  process.exit(1);
}
writeFileSync(new URL("../openapi/reseller-api.yaml", import.meta.url), header + body);

// The last commit that changed the source file, with "+changes" when the file is modified.
function sourceCommit(file) {
  const git = (...args) =>
    execFileSync("git", ["-C", dirname(file), ...args], { encoding: "utf8" }).trim();
  try {
    const hash = git("log", "-1", "--format=%h", "--", file.split("/").pop());
    const dirty = git("status", "--porcelain", "--", file.split("/").pop()) !== "";
    return hash ? `${hash}${dirty ? "+changes" : ""}` : "unknown";
  } catch {
    return "unknown";
  }
}
