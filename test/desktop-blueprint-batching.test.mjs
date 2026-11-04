import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Failure memory 2026-11-04: desktop materialization still posted one blob per file and hit the
// Cloudflare Worker subrequest limit (same root cause as the 2026-09-24 Android incident).
const source = readFileSync(new URL("../src/desktop-provisioning.ts", import.meta.url), "utf8");
const materializer = source.slice(source.indexOf("const targetEntries"), source.indexOf("const targetTree"));

test("desktop blueprint sends text files inline in the tree request", () => {
  assert.match(materializer, /if \(!isBinary\) \{[\s\S]*?content: renderBlueprintText/);
  assert.equal(materializer.match(/\/git\/blobs`/g)?.length, 1, "only binary assets get their own blob write");
  assert.ok(materializer.indexOf("if (!isBinary)") < materializer.indexOf("/git/blobs`"), "text return comes before any blob write");
});

test("binary base64 is stripped of whitespace, not of the letter s", () => {
  assert.ok(materializer.includes(String.raw`replace(/\s+/g, "")`));
  assert.ok(!materializer.includes(String.raw`replace(/\\s+/g, "")`));
});
