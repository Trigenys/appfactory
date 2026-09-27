import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

for (const sourcePath of ["src/brownfield-worker.ts", "src/service-cloudflare.ts"]) {
  test(`${sourcePath} binds Workers Builds to the current AppFactory user token`, () => {
    const source = fs.readFileSync(sourcePath, "utf8");
    const start = source.indexOf("async function resolveBuildTokenUuid");
    const end = source.indexOf("async function listWorkerBuilds", start);
    const block = source.slice(start, end);

    assert.match(block, /\/user\/tokens\/verify/);
    assert.match(block, /cloudflare_token_id === verification\.id/);
    assert.match(block, /build_token_secret: env\.CLOUDFLARE_API_TOKEN/);
    assert.match(block, /method: "POST"/);
    assert.doesNotMatch(block, /CLOUDFLARE_BUILD_TOKEN_SOURCE_WORKER/);
    assert.match(block, /existing\.build_token_uuid/);
    assert.match(block, /build_token_uuid: buildTokenUuid/);
  });
}
