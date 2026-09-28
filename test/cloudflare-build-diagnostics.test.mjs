import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("brownfield provisioning surfaces failed Workers Builds with log excerpts", () => {
  const source = fs.readFileSync("src/brownfield-worker.ts", "utf8");

  assert.match(source, /\/builds\/builds\/\$\{encodeURIComponent\(buildUuid\)\}\/logs/);
  assert.match(source, /build\.build_outcome === "fail"/);
  assert.match(source, /metadata\.build_token_uuid !== trigger\.build_token_uuid/);
  assert.match(source, /CLOUDFLARE_WORKERS_BUILD_FAILED/);
  assert.match(source, /Cloudflare Workers Build \$\{failedCurrentBuild\.build_uuid\} failed before deployment/);
});

test("worker API reports build failures as upstream failures", () => {
  const source = fs.readFileSync("src/index.ts", "utf8");
  assert.match(source, /error\.code === "CLOUDFLARE_WORKERS_BUILD_FAILED"/);
});
