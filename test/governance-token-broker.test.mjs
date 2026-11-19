import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync("src/governance-token-broker.ts", "utf8");
const router = fs.readFileSync("src/index.ts", "utf8");
const auth = fs.readFileSync("src/auth.ts", "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const {
  authorizeGovernanceClaims,
  governanceBrokerConfig,
  issueGovernanceInstallationToken,
  handleGovernanceInstallationToken,
  GovernanceBrokerError
} = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

const SHA = "0123456789abcdef0123456789abcdef01234567";
const GOVERNANCE_WORKFLOW =
  `EagleFox31/appfactory-project-automation/.github/workflows/reusable-repository-governance.yml@${SHA}`;
const env = {
  GOVERNANCE_ALLOWED_OWNERS: "EagleFox31, Trigenys",
  GOVERNANCE_ALLOWED_JOB_WORKFLOW_REFS: GOVERNANCE_WORKFLOW
};
const config = governanceBrokerConfig(env);
const validClaims = {
  iss: "https://token.actions.githubusercontent.com",
  aud: "appfactory-governance",
  exp: Math.floor(Date.now() / 1000) + 300,
  repository: "EagleFox31/cfao-projets",
  repository_owner: "EagleFox31",
  job_workflow_ref: GOVERNANCE_WORKFLOW,
  workflow_ref: "EagleFox31/cfao-projets/.github/workflows/repository-governance.yml@refs/heads/main",
  ref: "refs/heads/main"
};

function rejects(fn, code, status) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof GovernanceBrokerError, `expected GovernanceBrokerError, got ${error}`);
    assert.equal(error.code, code);
    if (status) assert.equal(error.status, status);
    return true;
  });
}

test("broker configuration defaults the audience and requires both allowlists", () => {
  assert.equal(config.audience, "appfactory-governance");
  assert.deepEqual(config.allowedOwners, ["EagleFox31", "Trigenys"]);
  assert.deepEqual(config.allowedJobWorkflowRefs, [GOVERNANCE_WORKFLOW]);
  assert.equal(
    governanceBrokerConfig({ ...env, GOVERNANCE_OIDC_AUDIENCE: "custom" }).audience,
    "custom"
  );
  rejects(() => governanceBrokerConfig({}), "GOVERNANCE_BROKER_NOT_CONFIGURED", 503);
  rejects(
    () => governanceBrokerConfig({ GOVERNANCE_ALLOWED_OWNERS: "EagleFox31" }),
    "GOVERNANCE_BROKER_NOT_CONFIGURED",
    503
  );
});

test("allowed workflow refs must be pinned to a commit SHA, never a branch or tag", () => {
  for (const ref of [
    "EagleFox31/appfactory-project-automation/.github/workflows/reusable-repository-governance.yml@refs/heads/main",
    "EagleFox31/appfactory-project-automation/.github/workflows/reusable-repository-governance.yml@refs/tags/v1",
    "EagleFox31/appfactory-project-automation/.github/workflows/reusable-repository-governance.yml@abc123"
  ]) {
    rejects(
      () => governanceBrokerConfig({ ...env, GOVERNANCE_ALLOWED_JOB_WORKFLOW_REFS: ref }),
      "GOVERNANCE_BROKER_MISCONFIGURED",
      503
    );
  }
});

test("verified claims from an allowed owner and pinned governance workflow resolve the target", () => {
  assert.deepEqual(authorizeGovernanceClaims(validClaims, config), {
    owner: "EagleFox31",
    repo: "cfao-projets"
  });
  assert.deepEqual(
    authorizeGovernanceClaims(
      { ...validClaims, repository: "trigenys/appfactory", repository_owner: "trigenys" },
      config
    ),
    { owner: "trigenys", repo: "appfactory" }
  );
});

test("owners outside the allowlist are refused", () => {
  rejects(
    () =>
      authorizeGovernanceClaims(
        { ...validClaims, repository: "someone-else/cfao-projets", repository_owner: "someone-else" },
        config
      ),
    "GOVERNANCE_OWNER_FORBIDDEN",
    403
  );
  rejects(
    () => authorizeGovernanceClaims({ ...validClaims, repository_owner: undefined }, config),
    "GOVERNANCE_OWNER_FORBIDDEN",
    403
  );
});

test("only the pinned reusable governance workflow may exchange a token", () => {
  for (const jobWorkflowRef of [
    undefined,
    "EagleFox31/appfactory-project-automation/.github/workflows/reusable-repository-governance.yml@refs/tags/v1",
    `EagleFox31/appfactory-project-automation/.github/workflows/reusable-project-automation.yml@${SHA}`,
    `EagleFox31/cfao-projets/.github/workflows/repository-governance.yml@${SHA}`
  ]) {
    rejects(
      () => authorizeGovernanceClaims({ ...validClaims, job_workflow_ref: jobWorkflowRef }, config),
      "GOVERNANCE_WORKFLOW_FORBIDDEN",
      403
    );
  }
});

test("the repository claim must belong to the authenticated owner and be well-formed", () => {
  for (const repository of [
    undefined,
    "cfao-projets",
    "Trigenys/appfactory",
    "EagleFox31/cfao-projets/extra",
    "EagleFox31/../admin"
  ]) {
    rejects(
      () => authorizeGovernanceClaims({ ...validClaims, repository }, config),
      "GOVERNANCE_REPOSITORY_INVALID",
      403
    );
  }
});

function fakeGitHub({ installationStatus = 200, tokenStatus = 201, tokenBody } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/installation")) {
      return new Response(
        JSON.stringify(installationStatus === 200 ? { id: 4242 } : { message: "Not Found" }),
        { status: installationStatus }
      );
    }
    if (url.includes("/access_tokens")) {
      return new Response(
        JSON.stringify(
          tokenBody ?? { token: "ghs_governance_test_only", expires_at: "2026-11-05T12:00:00Z" }
        ),
        { status: tokenStatus }
      );
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  return { calls, fetch };
}

test("issued token is restricted to the caller repository and administration:write", async () => {
  const github = fakeGitHub();
  const issued = await issueGovernanceInstallationToken(
    { owner: "EagleFox31", repo: "cfao-projets" },
    { appJwt: async () => "app.jwt.signed", fetch: github.fetch }
  );

  assert.equal(issued.token, "ghs_governance_test_only");
  assert.equal(issued.repository, "EagleFox31/cfao-projets");
  assert.equal(issued.installationId, 4242);
  assert.deepEqual(issued.permissions, { administration: "write" });

  assert.equal(github.calls.length, 2);
  assert.equal(
    github.calls[0].url,
    "https://api.github.com/repos/EagleFox31/cfao-projets/installation"
  );
  assert.equal(github.calls[0].init.headers.Authorization, "Bearer app.jwt.signed");
  assert.equal(github.calls[1].url, "https://api.github.com/app/installations/4242/access_tokens");
  assert.equal(github.calls[1].init.method, "POST");
  assert.deepEqual(JSON.parse(github.calls[1].init.body), {
    repositories: ["cfao-projets"],
    permissions: { administration: "write" }
  });
});

test("a repository without the App installed yields an actionable 403", async () => {
  const github = fakeGitHub({ installationStatus: 404 });
  await assert.rejects(
    issueGovernanceInstallationToken(
      { owner: "EagleFox31", repo: "cfao-projets" },
      { appJwt: async () => "app.jwt.signed", fetch: github.fetch }
    ),
    (error) => {
      assert.equal(error.code, "GITHUB_APP_NOT_INSTALLED");
      assert.equal(error.status, 403);
      assert.match(error.message, /not installed on EagleFox31\/cfao-projets/);
      assert.match(error.message, /selected repositories/);
      return true;
    }
  );
  assert.equal(github.calls.length, 1);
});

test("a permission refusal from GitHub explains the missing App permission", async () => {
  const github = fakeGitHub({ tokenStatus: 422, tokenBody: { message: "Administration not granted" } });
  await assert.rejects(
    issueGovernanceInstallationToken(
      { owner: "EagleFox31", repo: "cfao-projets" },
      { appJwt: async () => "app.jwt.signed", fetch: github.fetch }
    ),
    (error) => {
      assert.equal(error.code, "GITHUB_APP_PERMISSION_UNAVAILABLE");
      assert.equal(error.status, 422);
      assert.match(error.message, /Administration: Read and write/);
      return true;
    }
  );
});

test("the HTTP handler takes the repository from verified claims only and never echoes secrets", async () => {
  const github = fakeGitHub();
  const request = new Request("https://appfactory.example/v1/github/installation-token", {
    method: "POST",
    headers: { authorization: "Bearer oidc.token", "content-type": "application/json" },
    body: JSON.stringify({ repository: "EagleFox31/other-repo", permissions: { contents: "write" } })
  });
  const response = await handleGovernanceInstallationToken(request, env, {
    verifyOidc: async (_request, audience) => {
      assert.equal(audience, "appfactory-governance");
      return validClaims;
    },
    appJwt: async () => "app.jwt.signed",
    fetch: github.fetch
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.deepEqual(body, {
    token: "ghs_governance_test_only",
    expiresAt: "2026-11-05T12:00:00Z",
    repository: "EagleFox31/cfao-projets",
    permissions: { administration: "write" }
  });
  assert.deepEqual(JSON.parse(github.calls[1].init.body).repositories, ["cfao-projets"]);
});

test("the HTTP handler maps OIDC authentication failures and policy refusals to JSON errors", async () => {
  const github = fakeGitHub();
  const request = new Request("https://appfactory.example/v1/github/installation-token", {
    method: "POST"
  });

  const authFailure = await handleGovernanceInstallationToken(request, env, {
    verifyOidc: async () => {
      throw Object.assign(new Error("GitHub OIDC signature is invalid."), {
        status: 401,
        code: "OIDC_SIGNATURE_INVALID"
      });
    },
    appJwt: async () => "app.jwt.signed",
    fetch: github.fetch
  });
  assert.equal(authFailure.status, 401);
  assert.deepEqual(await authFailure.json(), {
    error: "OIDC_SIGNATURE_INVALID",
    message: "GitHub OIDC signature is invalid."
  });

  const policyFailure = await handleGovernanceInstallationToken(request, env, {
    verifyOidc: async () => ({ ...validClaims, repository_owner: "intruder", repository: "intruder/x" }),
    appJwt: async () => "app.jwt.signed",
    fetch: github.fetch
  });
  assert.equal(policyFailure.status, 403);
  assert.equal((await policyFailure.json()).error, "GOVERNANCE_OWNER_FORBIDDEN");
  assert.equal(github.calls.length, 0);

  const unconfigured = await handleGovernanceInstallationToken(request, {}, {
    verifyOidc: async () => validClaims,
    appJwt: async () => "app.jwt.signed",
    fetch: github.fetch
  });
  assert.equal(unconfigured.status, 503);

  const internal = await handleGovernanceInstallationToken(request, env, {
    verifyOidc: async () => validClaims,
    appJwt: async () => {
      throw new Error("Missing GITHUB_PRIVATE_KEY Worker secret. -----BEGIN RSA PRIVATE KEY-----");
    },
    fetch: github.fetch
  });
  assert.equal(internal.status, 500);
  assert.doesNotMatch(await internal.text(), /PRIVATE KEY/);
});

test("the route is wired with the shared OIDC verifier and App JWT signer", () => {
  assert.match(router, /url\.pathname === "\/v1\/github\/installation-token"/);
  assert.match(router, /verifyOidc: verifySignedOidcToken/);
  assert.match(router, /appJwt: \(\) => createGitHubAppJwt\(env\)/);
  assert.match(auth, /export async function verifySignedOidcToken/);
  assert.match(auth, /job_workflow_ref\?: string/);
  assert.match(auth, /repository_owner\?: string/);
  assert.doesNotMatch(source, /GITHUB_PRIVATE_KEY/);
});
