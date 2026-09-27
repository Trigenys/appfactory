import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

for (const sourcePath of ["src/brownfield-worker.ts", "src/service-cloudflare.ts"]) {
  test(`${sourcePath} routes resource and Builds API calls to separate credentials`, () => {
    const source = fs.readFileSync(sourcePath, "utf8");

    assert.match(source, /const isBuildsApi = path\.includes\("\/builds\/"\) \|\| path\.endsWith\("\/builds"\)/);
    assert.match(source, /isBuildsApi\s*\? env\.CLOUDFLARE_API_TOKEN\s*:\s*env\.CLOUDFLARE_PAGES_D1_TOKEN \|\| env\.CLOUDFLARE_API_TOKEN/);
    assert.match(source, /Resource APIs use CLOUDFLARE_PAGES_D1_TOKEN when configured; Workers Builds uses the user-scoped CLOUDFLARE_API_TOKEN/);
  });
}
