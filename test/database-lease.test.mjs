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
const claims={repository:"Trigenys/trigenys-seo-monitor"};
const goodUrl="postgresql://seo_monitor_owner:test-not-a-real-password@ep-demo.c-6.eu-central-1.aws.neon.tech:5432/seo_monitor?sslmode=require";
const env={APPFACTORY_DATABASE_TRIGENYS_SEO_MONITOR_URL:goodUrl};
const request={repository:claims.repository};

test("OIDC database lease trust is pinned to canonical SEO Monitor workflow, main and full events",()=>{
  assert.match(auth,/authenticateDatabaseLease/);
  assert.match(auth,/verifyOidcToken\(request, env\)/);
  assert.match(auth,/Trigenys\/trigenys-seo-monitor/);
  assert.match(auth,/\.github\/workflows\/seo-monitor\.yml@/);
  assert.match(auth,/claims\.workflow_ref !== allowedWorkflow/);
  assert.match(auth,/claims\.event_name !== "schedule" && claims\.event_name !== "workflow_dispatch"/);
});

test("only exact repository requests allowed and arbitrary profile selectors rejected",()=>{
  assert.throws(()=>issueDatabaseLease(env,{repository:"Trigenys/other"},request),e=>e.code==="DATABASE_LEASE_REPOSITORY_MISMATCH");
  assert.throws(()=>issueDatabaseLease(env,claims,{repository:"Trigenys/other"}),e=>e.code==="DATABASE_LEASE_REPOSITORY_MISMATCH");
  assert.throws(()=>issueDatabaseLease(env,claims,{...request,profile:"product-identity-production"}),e=>e.code==="DATABASE_LEASE_FIELDS_FORBIDDEN");
  assert.throws(()=>issueDatabaseLease(env,claims,{...request,database:"product_identity"}),e=>e.code==="DATABASE_LEASE_FIELDS_FORBIDDEN");
  assert.throws(()=>issueDatabaseLease(env,claims,{}),e=>e.code==="DATABASE_LEASE_REPOSITORY_MISMATCH");
});

test("missing or incorrect private Neon profile fails closed without leaking credentials",()=>{
  assert.throws(()=>issueDatabaseLease({},claims,request),e=>e.code==="DATABASE_LEASE_NOT_CONFIGURED"&&!e.message.includes("test-not-a-real-password"));
  for(const badUrl of [
    "postgresql://seo_monitor_owner:demo@server.example.org:5432/seo_monitor",
    "postgresql://neondb_owner:demo@ep-demo.neon.tech:5432/seo_monitor",
    "postgresql://seo_monitor_owner:demo@ep-demo.neon.tech:5432/product_identity",
    "https://seo_monitor_owner:demo@ep-demo.neon.tech/seo_monitor",
    "postgresql://seo_monitor_owner@ep-demo.neon.tech:5432/seo_monitor"
  ]){
    assert.throws(()=>issueDatabaseLease({APPFACTORY_DATABASE_TRIGENYS_SEO_MONITOR_URL:badUrl},claims,request),e=>e.code==="DATABASE_LEASE_INVALID_PROFILE"&&!e.message.includes("demo"));
  }
});

test("valid lease returns only intended db and strips dangerous pg SSL overrides",()=>{
  const lease=issueDatabaseLease(env,claims,request);
  assert.equal(lease.status,"READY");
  assert.equal(lease.repository,claims.repository);
  assert.equal(lease.database,"seo_monitor");
  assert.equal(lease.databaseUrl.includes("sslmode="),false);
  assert.equal(lease.databaseUrl.startsWith("postgresql://seo_monitor_owner:"),true);
});

test("router uses OIDC, noncacheable response and sanitized errors",()=>{
  assert.match(router,/url\.pathname === "\/infrastructure\/database-lease"/);
  assert.match(router,/await authenticateDatabaseLease\(request, env\)/);
  assert.match(router,/issueDatabaseLease\(env, claims, body\)/);
  assert.match(router,/"cache-control": "no-store, private"/);
  assert.match(types,/APPFACTORY_DATABASE_TRIGENYS_SEO_MONITOR_URL\?: string/);
  assert.doesNotMatch(router,/console\.log\(.*databaseUrl/);
  assert.doesNotMatch(leaseSource,/console\.(?:log|warn|error)/);
});
