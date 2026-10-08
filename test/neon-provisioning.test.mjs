import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync("src/neon-provisioning.ts", "utf8");
const authSource = fs.readFileSync("src/auth.ts", "utf8");
const indexSource = fs.readFileSync("src/index.ts", "utf8");
const workerSource = fs.readFileSync("src/brownfield-worker.ts", "utf8");
const { provisionApprovedNeon, NeonProvisioningError, approvedNeonTarget } =
  await import("data:text/javascript;base64," + Buffer.from(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
    }).outputText
  ).toString("base64"));

const repo = "Trigenys/trigenys-seo-monitor";
const claims = { repository: repo };
const target = approvedNeonTarget({}, repo);
const exampleUrl = "postgresql://seo_monitor_owner:example-fake-only@ep-example.neon.tech/seo_monitor?sslmode=require&channel_binding=require";
const cleanUrl = "postgresql://seo_monitor_owner:example-fake-only@ep-example.neon.tech/seo_monitor?channel_binding=require";
const base = "https://console.neon.tech/api/v2/projects/little-frog-93793324";
const branchPath = base + "/branches/br-twilight-star-b2orr8hw";
const env = { NEON_API_KEY: "fake-neon-api-key" };

function dependencies({roles = [{name:"seo_monitor_owner"}], dbs = [{name:"seo_monitor",owner_name:"seo_monitor_owner"}], savedSecrets = [], onFetch} = {}) {
  const calls = [];
  const writes = [];
  const fetcher = async (url, init) => {
    calls.push({url, method:init?.method, body:init?.body});
    if (onFetch) {
      const override = await onFetch(url, init);
      if (override) return override;
    }
    if (url === branchPath + "/roles" && init?.method === "GET") {
      return Response.json({roles});
    }
    if (url === branchPath + "/databases" && init?.method === "GET") {
      return Response.json({databases:dbs});
    }
    if (url === branchPath + "/roles" && init?.method === "POST") {
      return Response.json({role:{name:"seo_monitor_owner"}},{status:201});
    }
    if (url === branchPath + "/databases" && init?.method === "POST") {
      return Response.json({database:{name:"seo_monitor",owner_name:"seo_monitor_owner"}},{status:201});
    }
    if (url.startsWith(base + "/connection_uri?") && init?.method === "GET") {
      return Response.json({uri:exampleUrl});
    }
    return Response.json({error:"unknown request"},{status:404});
  };
  return {
    calls,writes,
    handlers: {
      fetch:fetcher,
      listSecretNames:async (_env,workerName) => {
        assert.equal(workerName, "appfactory-api");
        return new Set(savedSecrets);
      },
      putSecret:async (_env, workerName, name, value) => {
        writes.push({workerName,name,value});
      }
    }
  };
}

test("approved SEO target is immutable and existing infrastructure is not re-provisioned", async () => {
  const mock = dependencies({savedSecrets:[target.secretName]});
  const result = await provisionApprovedNeon({},claims,{repository:repo},mock.handlers);
  assert.equal(result.status,"ALREADY_CONFIGURED");
  assert.deepEqual(mock.calls,[]);
  assert.deepEqual(mock.writes,[]);
  assert.equal(result.database,"seo_monitor");
  assert.equal(result.secretName,"APPFACTORY_DATABASE_TRIGENYS_SEO_MONITOR_URL");
});

test("missing Neon API key fails closed without creating resources or writing secrets", async () => {
  const mock = dependencies();
  await assert.rejects(
    provisionApprovedNeon({},claims,{repository:repo},mock.handlers),
    err => err instanceof NeonProvisioningError && err.code === "NEON_API_KEY_NOT_CONFIGURED"
  );
  assert.deepEqual(mock.calls,[]);
  assert.deepEqual(mock.writes,[]);
});

test("reuses Neon role/database, obtains URI privately, writes exactly one Cloudflare Worker secret", async () => {
  const mock = dependencies();
  const result = await provisionApprovedNeon(env,claims,{repository:repo},mock.handlers);
  assert.equal(result.status,"PROVISIONED");
  assert.equal(result.createdDatabase,false);
  assert.equal(result.createdRole,false);
  assert.equal(mock.calls.length,3);
  assert.deepEqual(mock.calls.map(c=>c.method),["GET","GET","GET"]);
  assert.ok(mock.calls.every(c=>c.url.startsWith("https://console.neon.tech/api/v2/")));
  assert.ok(mock.calls.every(c=>c.url.indexOf("example-fake-only")===-1));
  assert.equal(mock.writes.length,1);
  assert.deepEqual(mock.writes[0],{
    workerName:"appfactory-api",
    name:"APPFACTORY_DATABASE_TRIGENYS_SEO_MONITOR_URL",
    value:cleanUrl
  });
  assert.equal(JSON.stringify(result).includes("example-fake-only"),false);
  assert.equal(JSON.stringify(result).includes("fake-neon-api-key"),false);
});

test("rejects arbitrary caller profile, repository and secret names before fetching Neon", async () => {
  const mock=dependencies();
  for(const payload of [
    {repository:repo,projectId:"another-project"},
    {repository:repo,databaseName:"product_identity"},
    {repository:repo,secretName:"CLOUDFLARE_API_TOKEN"},
    {repository:repo,workerName:"appfactory-api"},
    {repository:"Trigenys/product-identity"}
  ]){
    await assert.rejects(provisionApprovedNeon(env,claims,payload,mock.handlers));
  }
  assert.deepEqual(mock.calls,[]);
  assert.deepEqual(mock.writes,[]);
});

test("rejects unapproved Trigenys repository even when its OIDC identity matches", async () => {
  const mock=dependencies();
  await assert.rejects(
    provisionApprovedNeon(env,{repository:"Trigenys/product-identity"},{repository:"Trigenys/product-identity"},mock.handlers),
    err => err.code==="NEON_TARGET_NOT_APPROVED"
  );
  assert.deepEqual(mock.writes,[]);
});

test("protects production databases from owner mismatch or unexpected missing role", async () => {
  for(const opts of [
    {dbs:[{name:"seo_monitor",owner_name:"product_identity_prod"}]},
    {roles:[]},
    {dbs:[]}
  ]){
    const mock=dependencies(opts);
    await assert.rejects(provisionApprovedNeon(env,claims,{repository:repo},mock.handlers));
    assert.equal(mock.calls.some(c=>c.method==="POST"),false);
    assert.deepEqual(mock.writes,[]);
  }
});

test("new approved repo can opt into creating only its own role/database and secret",async()=>{
  const newRepo="Trigenys/future-service";
  const approved={
    projectId:"little-frog-93793324",
    branchId:"br-twilight-star-b2orr8hw",
    databaseName:"future_service",
    roleName:"future_service_owner",
    workerName:"future-service-api",
    secretName:"FUTURE_SERVICE_DATABASE_URL",
    createMissing:true
  };
  const config={...env, APPFACTORY_NEON_TARGETS:JSON.stringify({[newRepo]:approved})};
  const target=approvedNeonTarget(config,newRepo);
  assert.deepEqual(target,approved);
  const calls=[],writes=[];
  const result=await provisionApprovedNeon(config,{repository:newRepo},{repository:newRepo},{
    listSecretNames:async()=>new Set(),
    putSecret:async(...args)=>writes.push({workerName:args[1],name:args[2],value:args[3]}),
    fetch:async(url,init)=>{
      calls.push({url,method:init?.method,body:init?.body});
      if(url.endsWith("/roles")&&init?.method==="GET")return Response.json({roles:[]});
      if(url.endsWith("/databases")&&init?.method==="GET")return Response.json({databases:[]});
      if(url.endsWith("/roles")&&init?.method==="POST")return Response.json({role:{name:target.roleName}},{status:201});
      if(url.endsWith("/databases")&&init?.method==="POST")return Response.json({database:{name:target.databaseName,owner_name:target.roleName}},{status:201});
      if(url.includes("/connection_uri?"))return Response.json({uri:"postgresql://future_service_owner:fake@ep-example.neon.tech/future_service"});
      return Response.json({error:"unknown"},{status:500});
    }
  });
  assert.equal(result.status,"PROVISIONED");
  assert.equal(result.createdRole,true);
  assert.equal(result.createdDatabase,true);
  assert.equal(writes.length,1);
  assert.equal(writes[0].workerName,"future-service-api");
  assert.equal(writes[0].name,"FUTURE_SERVICE_DATABASE_URL");
  assert.deepEqual(calls.filter(c=>c.method==="POST").map(c=>JSON.parse(c.body)),[
    {role:{name:"future_service_owner"}},
    {database:{name:"future_service",owner_name:"future_service_owner"}}
  ]);
});

test("malicious or unsafe additional targets are rejected and cannot override SEO Monitor",()=>{
  const good={
    projectId:"little-frog-93793324",branchId:"br-twilight-star-b2orr8hw",
    databaseName:"future_service",roleName:"future_service_owner",
    workerName:"future-service-api",secretName:"FUTURE_SERVICE_DATABASE_URL",createMissing:true
  };
  for(const config of [
    {[repo]:good},
    {"Trigenys/future-service":{...good,workerName:"appfactory-api"}},
    {"Trigenys/future-service":{...good,secretName:"CLOUDFLARE_API_TOKEN"}},
    {"Trigenys/future-service":{...good,projectId:"https://evil"}},
    {"OtherOrg/future-service":good}
  ]){
    assert.throws(()=>approvedNeonTarget({...env,APPFACTORY_NEON_TARGETS:JSON.stringify(config)},repo));
  }
});

test("Neon authentication, malformed URI and Cloudflare API errors never leak credentials",async()=>{
  const denied=dependencies({onFetch:async()=>Response.json({message:exampleUrl},{status:403})});
  await assert.rejects(provisionApprovedNeon(env,claims,{repository:repo},denied.handlers),
    err=>err.code==="NEON_API_PERMISSION_DENIED"&&!err.message.includes("example-fake-only"));
  const malformed=dependencies({onFetch:async(url)=>url.includes("/connection_uri?")
    ?Response.json({uri:"postgresql://seo_monitor_owner:fake@evil.example/seo_monitor"}):null});
  await assert.rejects(provisionApprovedNeon(env,claims,{repository:repo},malformed.handlers),
    err=>err.code==="NEON_CONNECTION_MISMATCH"&&!err.message.includes("fake"));
  assert.deepEqual(malformed.writes,[]);
  const cf=dependencies();
  cf.handlers.putSecret=async()=>{throw new Error("confidential: "+exampleUrl)};
  await assert.rejects(provisionApprovedNeon(env,claims,{repository:repo},cf.handlers),
    err=>err.code==="CLOUDFLARE_SECRET_WRITE_FAILED"&&!err.message.includes("example-fake-only"));
});

test("endpoint uses exact signed GitHub OIDC caller and never returns connection URI",()=>{
  assert.match(authSource,/authenticateNeonProvisioning/);
  assert.match(authSource,/verifyOidcToken\(request, env\)/);
  assert.match(authSource,/canonicalInfrastructureCaller/);
  assert.match(authSource,/claims\.event_name === "workflow_dispatch" \|\| claims\.event_name === "push"/);
  assert.match(authSource,/seoEventAllowed = claims\.event_name === "workflow_dispatch"/);
  assert.match(authSource,/NEON_PROVISIONER_EVENT_FORBIDDEN/);
  assert.match(indexSource,/url\.pathname === "\/infrastructure\/neon"/);
  assert.match(indexSource,/authenticateNeonProvisioning\(request, env\)/);
  assert.match(indexSource,/provisionApprovedNeon\(env, claims, body/);
  assert.match(indexSource,/"cache-control": "no-store, private"/);
  assert.match(workerSource,/export async function putSecret\(/);
  assert.match(workerSource,/export async function listSecretNames\(/);
  assert.doesNotMatch(source,/console\.(?:log|error|warn)/);
});


test("Editorial OS staging is a sealed AppFactory control-plane Neon target", () => {
  const target = approvedNeonTarget({}, "Trigenys/trigenys-editorial-os");
  assert.deepEqual(target, {
    projectId: "little-frog-93793324",
    branchId: "br-twilight-star-b2orr8hw",
    databaseName: "editorial_os_staging",
    roleName: "editorial_os_staging",
    workerName: "appfactory-api",
    secretName: "HYPERDRIVE_DATABASE_URL__TRIGENYS_EDITORIAL_OS_STAGING",
    createMissing: false
  });
  assert.throws(() => approvedNeonTarget({
    APPFACTORY_NEON_TARGETS: JSON.stringify({
      "Trigenys/trigenys-editorial-os": {
        projectId: "little-frog-93793324",
        branchId: "br-twilight-star-b2orr8hw",
        databaseName: "evil",
        roleName: "evil",
        workerName: "trigenys-editorial-os-api",
        secretName: "TRIGENYS_EDITORIAL_OS_DATABASE_URL",
        createMissing: false
      }
    })
  }, "Trigenys/trigenys-editorial-os"));
});


test("approved repo can provision Managed Better Auth without exposing its base URL", async () => {
  const authRepo="Trigenys/commerce-auth-test";
  const approved={
    projectId:"little-frog-93793324",
    branchId:"br-commerce-auth-test",
    databaseName:"commerce_auth_test",
    roleName:"commerce_auth_test_owner",
    workerName:"commerce-auth-test-api",
    secretName:"COMMERCE_AUTH_TEST_DATABASE_URL",
    createMissing:true,
    auth:{
      provider:"better_auth",
      applicationName:"Commerce Auth Test",
      baseUrlSecretName:"COMMERCE_AUTH_TEST_AUTH_BASE_URL"
    }
  };
  const config={...env,APPFACTORY_NEON_TARGETS:JSON.stringify({[authRepo]:approved})};
  const calls=[];
  const writes=[];
  const branchBase="https://console.neon.tech/api/v2/projects/little-frog-93793324/branches/br-commerce-auth-test";

  const result=await provisionApprovedNeon(
    config,
    {repository:authRepo},
    {repository:authRepo},
    {
      listSecretNames:async()=>new Set(),
      putSecret:async(_env,workerName,name,value)=>writes.push({workerName,name,value}),
      fetch:async(url,init)=>{
        calls.push({url,method:init?.method||"GET",body:init?.body});
        if(url===branchBase+"/roles"&&init?.method==="GET")return Response.json({roles:[]});
        if(url===branchBase+"/databases"&&init?.method==="GET")return Response.json({databases:[]});
        if(url===branchBase+"/roles"&&init?.method==="POST")return Response.json({role:{name:approved.roleName}},{status:201});
        if(url===branchBase+"/databases"&&init?.method==="POST")return Response.json({database:{name:approved.databaseName,owner_name:approved.roleName}},{status:201});
        if(url.includes("/connection_uri?"))return Response.json({uri:"postgresql://commerce_auth_test_owner:fake@ep-example.neon.tech/commerce_auth_test"});
        if(url===branchBase+"/auth"&&(!init?.method||init.method==="GET"))return Response.json({message:"not enabled"},{status:404});
        if(url===branchBase+"/auth"&&init?.method==="POST")return Response.json({
          auth_provider:"better_auth",
          base_url:"https://ep-commerce.neonauth.eu-central-1.aws.neon.tech/commerce_auth_test/auth",
          jwks_url:"https://ep-commerce.neonauth.eu-central-1.aws.neon.tech/commerce_auth_test/auth/.well-known/jwks.json"
        },{status:201});
        if(url===branchBase+"/auth/config"&&init?.method==="PATCH")return Response.json({name:"Commerce Auth Test"});
        return Response.json({error:"unknown"},{status:500});
      }
    }
  );

  assert.equal(result.status,"PROVISIONED");
  assert.equal(result.auth.enabled,true);
  assert.equal(result.auth.created,true);
  assert.equal(result.auth.baseUrlSecretName,"COMMERCE_AUTH_TEST_AUTH_BASE_URL");
  assert.equal(JSON.stringify(result).includes("ep-commerce"),false);
  assert.deepEqual(writes.map(item=>({workerName:item.workerName,name:item.name})),[
    {workerName:"commerce-auth-test-api",name:"COMMERCE_AUTH_TEST_DATABASE_URL"},
    {workerName:"commerce-auth-test-api",name:"COMMERCE_AUTH_TEST_AUTH_BASE_URL"}
  ]);
  assert.equal(writes[1].value,"https://ep-commerce.neonauth.eu-central-1.aws.neon.tech/commerce_auth_test/auth");
  assert.ok(calls.some(call=>call.url===branchBase+"/auth"&&call.method==="POST"));
  assert.ok(calls.some(call=>call.url===branchBase+"/auth/config"&&call.method==="PATCH"));
});

test("Managed Better Auth target stays repository-scoped", () => {
  const base={
    projectId:"little-frog-93793324",
    branchId:"br-commerce-auth-test",
    databaseName:"commerce_auth_test",
    roleName:"commerce_auth_test_owner",
    workerName:"commerce-auth-test-api",
    secretName:"COMMERCE_AUTH_TEST_DATABASE_URL",
    createMissing:true,
    auth:{
      provider:"better_auth",
      applicationName:"Commerce Auth Test",
      baseUrlSecretName:"COMMERCE_AUTH_TEST_AUTH_BASE_URL"
    }
  };
  assert.throws(()=>approvedNeonTarget({
    ...env,
    APPFACTORY_NEON_TARGETS:JSON.stringify({
      "Trigenys/commerce-auth-test":{
        ...base,
        auth:{...base.auth,baseUrlSecretName:"CLOUDFLARE_API_TOKEN"}
      }
    })
  },"Trigenys/commerce-auth-test"));
});
