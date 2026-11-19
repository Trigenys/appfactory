import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Failure memory 2026-09-24 (Android) and 2026-11-04 (desktop): materializers posted one blob per
// file and exhausted the Cloudflare Worker subrequest limit. The fix lives in one shared module;
// this test executes it and guards that every provisioning path uses it.
const { materializeBlueprint, isBinaryPath } = await import("../src/blueprint-materializer.ts");

const PROVISIONING_PATHS = ["desktop", "mobile", "service", "webapp"];
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const b64 = (text) => Buffer.from(text, "utf8").toString("base64");

function mockGitHub(files) {
  const calls = [];
  const tree = Object.entries(files).map(([path, file], index) => ({
    path, mode: file.mode || "100644", type: "blob", sha: `src${index}`
  }));
  const blobs = new Map(tree.map((entry) => [entry.sha, files[entry.path].content]));
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).replace("https://api.github.com", "");
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    let json;
    if (method === "GET" && /^\/repos\/[^/]+\/[^/]+$/.test(path)) json = { default_branch: "main" };
    else if (path.includes("/git/trees/")) json = { truncated: false, tree };
    else if (method === "GET" && path.includes("/git/blobs/")) {
      // GitHub wraps base64 at 60 columns: exercise whitespace stripping.
      json = { encoding: "base64", content: blobs.get(path.split("/").pop()).replace(/(.{60})/g, "$1\n") };
    } else if (method === "POST" && path.endsWith("/git/blobs")) json = { sha: `bin${calls.length}` };
    else if (method === "POST" && path.endsWith("/git/trees")) json = { sha: "tree1" };
    else if (path.includes("/git/ref/heads/")) json = { object: { sha: "parent1" } };
    else if (path.endsWith("/git/commits")) json = { sha: "commit1" };
    else if (method === "PATCH") json = { ref: "refs/heads/main" };
    else throw new Error(`Unexpected request ${method} ${path}`);
    return new Response(JSON.stringify(json), { status: 200 });
  };
  return calls;
}

const repository = { name: "demo", full_name: "Acme/demo", html_url: "", default_branch: "main" };

test("text files travel inline in one tree request; only binaries get a blob write", async () => {
  const icon = Buffer.from(Array.from({ length: 192 }, (_, index) => (index * 37) % 256)).toString("base64");
  assert.ok(icon.includes("s") && icon.length > 60, "fixture must contain the letter s and wrap across lines");
  const longText = "s".repeat(200);
  const calls = mockGitHub({
    "blueprints/p/README.md": { content: b64("# __NAME__\n") },
    "blueprints/p/gradlew": { content: b64(longText), mode: "100755" },
    "blueprints/p/appfactoryplaceholder/Main.kt": { content: b64("package x") },
    "blueprints/p/icons/icon.ICO": { content: icon },
    "blueprints/other/ignored.txt": { content: b64("no") }
  });

  const sha = await materializeBlueprint({
    token: "t", kind: "desktop", preset: "p", source: { owner: "Acme", repo: "appfactory" },
    targetOwner: "Acme", repository,
    mapPath: (path) => path.replace("appfactoryplaceholder", "demo"),
    render: (content) => content.replaceAll("__NAME__", "Demo")
  });

  assert.equal(sha, "commit1");
  const blobWrites = calls.filter((call) => call.method === "POST" && call.path.endsWith("/git/blobs"));
  assert.equal(blobWrites.length, 1, "only the binary asset gets its own blob write");
  assert.equal(blobWrites[0].body.content, icon, "binary base64 is stripped of whitespace, not of the letter s");

  const treeWrites = calls.filter((call) => call.method === "POST" && call.path.endsWith("/git/trees"));
  assert.equal(treeWrites.length, 1);
  const entries = Object.fromEntries(treeWrites[0].body.tree.map((entry) => [entry.path, entry]));
  assert.deepEqual(Object.keys(entries).sort(), ["README.md", "demo/Main.kt", "gradlew", "icons/icon.ICO"]);
  assert.equal(entries["README.md"].content, "# Demo\n");
  assert.equal(entries["gradlew"].content, longText);
  assert.equal(entries["gradlew"].mode, "100755");
  assert.ok(entries["icons/icon.ICO"].sha.startsWith("bin"));

  const writes = calls.filter((call) => call.method !== "GET");
  assert.equal(writes.length, 4, "1 binary blob + 1 tree + 1 commit + 1 ref update");
  assert.deepEqual(calls.find((call) => call.path.endsWith("/git/commits")).body, {
    message: "feat(appfactory): materialize p desktop blueprint", tree: "tree1", parents: ["parent1"]
  });
  assert.deepEqual(calls.at(-1), {
    method: "PATCH", path: "/repos/Acme/demo/git/refs/heads/main", body: { sha: "commit1", force: false }
  });
});

test("extra files are appended and win on duplicate target paths", async () => {
  mockGitHub({
    "blueprints/p/src/App.tsx": { content: b64("default") },
    "ui-registry/App.tsx": { content: b64("profile") }
  });
  let captured;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if ((init.method || "GET") === "POST" && String(url).endsWith("/git/trees")) captured = JSON.parse(init.body).tree;
    return original(url, init);
  };
  await materializeBlueprint({
    token: "t", kind: "webapp", preset: "p", source: { owner: "Acme", repo: "appfactory", ref: "main" },
    targetOwner: "Acme", repository,
    extraFiles: async ({ tree }) => [{ entry: tree.find((e) => e.path === "ui-registry/App.tsx"), targetPath: "src/App.tsx" }],
    render: (content) => content
  });
  assert.deepEqual(captured, [{ path: "src/App.tsx", mode: "100644", type: "blob", content: "profile" }]);
});

test("empty or truncated blueprint trees fail before any write", async () => {
  const calls = mockGitHub({ "blueprints/other/a.txt": { content: b64("a") } });
  await assert.rejects(
    materializeBlueprint({
      token: "t", kind: "service", preset: "p", source: { owner: "Acme", repo: "appfactory" },
      targetOwner: "Acme", repository, render: (content) => content
    }),
    /No files found for service blueprint p/
  );
  assert.equal(calls.filter((call) => call.method !== "GET").length, 0);
});

test("binary detection is case-insensitive and covers fonts and icons", () => {
  for (const path of ["a.ico", "b.ICNS", "c.png", "d.woff2", "e.webp"]) assert.ok(isBinaryPath(path), path);
  for (const path of ["a.ts", "gradlew", "icons.json", "README.md"]) assert.ok(!isBinaryPath(path), path);
});

for (const kind of PROVISIONING_PATHS) {
  test(`${kind} provisioning materializes through the shared module`, () => {
    const source = read(`src/${kind}-provisioning.ts`);
    assert.match(source, /from "\.\/blueprint-materializer"/);
    assert.match(source, new RegExp(String.raw`materializeSharedBlueprint\(\{[\s\S]*?kind: "${kind}"`));
    assert.doesNotMatch(source, /\/git\/blobs`/, "no per-file blob write outside the shared module");
    assert.doesNotMatch(source, /\/git\/trees`/, "no private tree write outside the shared module");
  });
}
