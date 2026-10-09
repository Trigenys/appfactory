import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const auth=fs.readFileSync("src/auth.ts","utf8");
const router=fs.readFileSync("src/index.ts","utf8");
const leaseSource=fs.readFileSync("src/database-lease.ts","utf8");
const types=fs.readFileSync("src/types.ts","utf8");
const js=ts.transpileModule(leaseSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {issueDatabaseLease}=await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));

const seoClaims={repository:"Trigenys/trigenys-seo-monitor"};
const seoUrl="postgresql://seo_monitor_owner:test-not-a-real-password@ep-demo.c-6.eu-central-1.aws.neon.tech:5432/seo_monitor?sslmode=require";
const seoEnv={APPFACTORY_DATABASE_TRIGENYS_SEO_MONITOR_URL:seoUrl};
const seoRequest={repository:seoClaims.repository};

const editorialClaims={repository:"Trigenys/trigenys-editorial-os"};
const editorialUrl="postgresql://editorial_os_staging:test-not-a-real-password@ep-demo.c-6.eu-central-1.aws.neon.tech:5432/editorial_os_staging?sslmode=require";
const editorialEnv={HYPERDRIVE_DATABASE_URL__TRIGENYS_EDITORIAL_OS_STAGING:editorialUrl};
const editorialRequest={repository:editorialClaims.repository};

test("OIDC database lease trust is pinned to approved collector workflows on main and full events",()=>{
  assert.match(auth,/authenticateDatabaseLease/);
  assert.match(auth,/verifyOidcToken\(request, env\)/);
  assert.match(auth,/Trigenys\/trigenys-seo-monitor/);
  assert.match(auth,/\.github\/workflows\/seo-monitor\.yml@/);
  assert.match(auth,/Trigenys\/trigenys-editorial-os/);
  assert.match(auth,/\.github\/workflows\/news-scout\.yml@/);
  assert.match(auth,/claims\.workflow_ref !== allowedWorkflow/);
  assert.match(auth,/claims\.event_name === "schedule"/);
  assert.match(auth,/claims\.event_name === "workflow_dispatch"/);
  assert.match(auth,/repository === "Trigenys\/trigenys-editorial-os"/);
  assert.match(auth,/claims\.event_name === "push"/);
});

test("only exact repository requests allowed and arbitrary profile selectors rejected",()=>{
  assert.throws(()=>issueDatabaseLease(seoEnv,{repository:"Trigenys/other"},seoRequest),e=>e.code==="DATABASE_LEASE_REPOSITORY_FORBIDDEN");
  assert.throws(()=>issueDatabaseLease(seoEnv,seoClaims,{repository:"Trigenys/other"}),e=>e.code==="DATABASE_LEASE_REPOSITORY_MISMATCH");
  assert.throws(()=>issueDatabaseLease(seoEnv,seoClaims,{...seoRequest,profile:"product-identity-production"}),e=>e.code==="DATABASE_LEASE_FIELDS_FORBIDDEN");
  assert.throws(()=>issueDatabaseLease(editorialEnv,editorialClaims,{...editorialRequest,database:"seo_monitor"}),e=>e.code==="DATABASE_LEASE_FIELDS_FORBIDDEN");
  assert.throws(()=>issueDatabaseLease(editorialEnv,seoClaims,editorialRequest),e=>e.code==="DATABASE_LEASE_REPOSITORY_MISMATCH");
});

test("missing or incorrect private Neon profiles fail closed without leaking credentials",()=>{
  assert.throws(()=>issueDatabaseLease({},seoClaims,seoRequest),e=>e.code==="DATABASE_LEASE_NOT_CONFIGURED"&&!e.message.includes("test-not-a-real-password"));
  assert.throws(()=>issueDatabaseLease({},editorialClaims,editorialRequest),e=>e.code==="DATABASE_LEASE_NOT_CONFIGURED"&&!e.message.includes("test-not-a-real-password"));

  for(const badUrl of [
    "postgresql://seo_monitor_owner:demo@server.example.org:5432/seo_monitor",
    "postgresql://neondb_owner:demo@ep-demo.neon.tech:5432/seo_monitor",
    "postgresql://seo_monitor_owner:demo@ep-demo.neon.tech:5432/product_identity",
    "https://seo_monitor_owner:demo@ep-demo.neon.tech/seo_monitor",
    "postgresql://seo_monitor_owner@ep-demo.neon.tech:5432/seo_monitor"
  ]){
    assert.throws(()=>issueDatabaseLease({APPFACTORY_DATABASE_TRIGENYS_SEO_MONITOR_URL:badUrl},seoClaims,seoRequest),e=>e.code==="DATABASE_LEASE_INVALID_PROFILE"&&!e.message.includes("demo"));
  }

  for(const badUrl of [
    "postgresql://editorial_os_staging:demo@server.example.org:5432/editorial_os_staging",
    "postgresql://other_role:demo@ep-demo.neon.tech:5432/editorial_os_staging",
    "postgresql://editorial_os_staging:demo@ep-demo.neon.tech:5432/seo_monitor",
    "https://editorial_os_staging:demo@ep-demo.neon.tech/editorial_os_staging"
  ]){
    assert.throws(()=>issueDatabaseLease({HYPERDRIVE_DATABASE_URL__TRIGENYS_EDITORIAL_OS_STAGING:badUrl},editorialClaims,editorialRequest),e=>e.code==="DATABASE_LEASE_INVALID_PROFILE"&&!e.message.includes("demo"));
  }
});

test("valid leases return only intended db and strip dangerous pg SSL overrides",()=>{
  const seoLease=issueDatabaseLease(seoEnv,seoClaims,seoRequest);
  assert.equal(seoLease.status,"READY");
  assert.equal(seoLease.repository,seoClaims.repository);
  assert.equal(seoLease.database,"seo_monitor");
  assert.equal(seoLease.databaseUrl.includes("sslmode="),false);
  assert.equal(seoLease.databaseUrl.startsWith("postgresql://seo_monitor_owner:"),true);

  const editorialLease=issueDatabaseLease(editorialEnv,editorialClaims,editorialRequest);
  assert.equal(editorialLease.status,"READY");
  assert.equal(editorialLease.repository,editorialClaims.repository);
  assert.equal(editorialLease.database,"editorial_os_staging");
  assert.equal(editorialLease.databaseUrl.includes("sslmode="),false);
  assert.equal(editorialLease.databaseUrl.startsWith("postgresql://editorial_os_staging:"),true);
});

test("router uses OIDC, noncacheable response and sanitized errors",()=>{
  assert.match(router,/url\.pathname === "\/infrastructure\/database-lease"/);
  assert.match(router,/await authenticateDatabaseLease\(request, env\)/);
  assert.match(router,/issueDatabaseLease\(env, claims, body\)/);
  assert.match(router,/"cache-control": "no-store, private"/);
  assert.match(types,/APPFACTORY_DATABASE_TRIGENYS_SEO_MONITOR_URL\?: string/);
  assert.match(types,/HYPERDRIVE_DATABASE_URL__TRIGENYS_EDITORIAL_OS_STAGING\?: string/);
  assert.doesNotMatch(router,/console\.log\(.*databaseUrl/);
  assert.doesNotMatch(leaseSource,/console\.(?:log|warn|error)/);
});
