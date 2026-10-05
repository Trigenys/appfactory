import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("brownfield Pages self-service is OIDC-scoped and explicit", () => {
  const source = fs.readFileSync("src/brownfield-pages.ts", "utf8");
  const api = fs.readFileSync("src/index.ts", "utf8");

  assert.match(source, /request\.repository !== oidcRepository/);
  assert.match(source, /\.appfactory\/pages-infrastructure\.json/);
  assert.match(source, /provider: "cloudflare-pages"/);
  assert.match(source, /ensurePagesProject/);
  assert.match(source, /ensurePagesCustomDomain/);
  assert.match(source, /findReusablePagesDeployment/);
  assert.match(source, /managedByAppFactory: false/);
  assert.match(api, /url\.pathname === "\/infrastructure\/pages"/);
  assert.match(api, /authenticateInfrastructureMutation/);
});

test("Pages provisioning reuses GitHub source verification and dedicated resource credentials", () => {
  const source = fs.readFileSync("src/cloudflare.ts", "utf8");
  const idempotency = fs.readFileSync("src/deployment-idempotency.ts", "utf8");

  assert.match(
    source,
    /env\.CLOUDFLARE_PAGES_D1_TOKEN \|\| env\.CLOUDFLARE_API_TOKEN/
  );
  assert.match(source, /project\.source\?\.type !== "github"/);
  assert.match(source, /config\?\.repo_id/);
  assert.match(source, /method: "PATCH"/);
  assert.match(source, /\/domains/);
  assert.match(
    idempotency,
    /env\.CLOUDFLARE_PAGES_D1_TOKEN \|\| env\.CLOUDFLARE_API_TOKEN/
  );
});

test("brownfield Pages constrains Cloudflare project names to the caller repository namespace", () => {
  const source = fs.readFileSync("src/brownfield-pages.ts", "utf8");

  assert.match(source, /projectName !== repoName/);
  assert.match(source, /projectName\.startsWith\(\`\$\{repoName\}-\`\)/);
  assert.match(source, /INFRASTRUCTURE_MARKER_MISMATCH/);
});
