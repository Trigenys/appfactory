import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const sources = [
  "src/brownfield-worker.ts",
  "src/service-cloudflare.ts"
];

for (const sourcePath of sources) {
  test(`${sourcePath} creates the Worker resource before uploading bootstrap code`, () => {
    const source = fs.readFileSync(sourcePath, "utf8");

    const createStart = source.indexOf("async function createWorkerResource");
    const uploadStart = source.indexOf("async function uploadBootstrapWorker");
    const bootstrapStart = source.indexOf("async function createBootstrapWorker");

    assert.notEqual(createStart, -1, "missing explicit Worker resource creation");
    assert.notEqual(uploadStart, -1, "missing bootstrap upload step");
    assert.notEqual(bootstrapStart, -1, "missing bootstrap orchestrator");

    const createBlock = source.slice(createStart, uploadStart);
    assert.match(createBlock, /\/workers\/workers`/);
    assert.match(createBlock, /method: "POST"/);
    assert.match(createBlock, /Workers product Admin \(create Worker\)/);

    const uploadBlock = source.slice(uploadStart, bootstrapStart);
    assert.match(uploadBlock, /\/workers\/scripts\//);
    assert.match(uploadBlock, /method: "PUT"/);
    assert.match(uploadBlock, /Workers product Editor \(deploy existing Worker\)/);

    const bootstrapBlock = source.slice(bootstrapStart, source.indexOf("async function ensureWorker", bootstrapStart));
    assert.match(bootstrapBlock, /createWorkerResource/);
    assert.match(bootstrapBlock, /uploadBootstrapWorker/);
    assert.match(bootstrapBlock, /method: "DELETE"/);
    assert.match(bootstrapBlock, /WORKER_BOOTSTRAP_ROLLBACK_FAILED/);
  });
}
