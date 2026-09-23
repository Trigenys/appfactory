# Engineering lessons learned

Record meaningful failures and near misses here with context, root cause, resolution and a recurrence-prevention guardrail. This repository follows the RAIDER Failure Memory principle from the Trigenys Project Registry.

## 2026-09-23 — Reusable release startup failure in first generated service

**Context:** `Trigenys/entitlement-service`, the first repository generated from this blueprint, invoked the shared release workflow on its initial `main` commit.

**Failure:** GitHub reported `startup_failure` before the reusable release job started.

**Root cause:** this blueprint granted only `contents: write` and `pull-requests: write`, while `EagleFox31/appfactory-project-automation/.github/workflows/reusable-release.yml@v1` also requires `issues: write`.

**Resolution:** add `issues: write` to the generated caller workflow.

**Guardrail:** when a blueprint calls a reusable workflow, keep the caller permission set synchronized with the reusable workflow contract and validate the first generated repository end to end.

## 2026-09-23 — Project automation ran before post-generation bootstrap

**Context:** generated service repositories include AppFactory Project Automation immediately, but `PROJECT_TOKEN` is a documented post-generation bootstrap credential.

**Failure mode:** opening the first pull request before adding the token caused a red Project Automation check unrelated to application correctness.

**Resolution:** generated workflows now emit a notice and skip Project synchronization while `PROJECT_TOKEN` is absent, then activate automatically when the credential is configured.

**Guardrail:** blueprint workflows must model post-generation configuration as an explicit bootstrap state rather than an unconditional runtime dependency.

## 2026-09-23 — Do not duplicate D1 migration state in AppFactory

**Context:** end-to-end service provisioning needs the first D1 schema applied automatically.

**Risk:** applying SQL directly from AppFactory with a second migration ledger would drift from Wrangler's native `d1_migrations` state and make later developer-operated migrations ambiguous.

**Decision:** Workers Builds runs `npm run d1:migrate:remote` before `wrangler deploy`. AppFactory provisions the database and delivery path, while Wrangler remains the migration authority.

**Guardrail:** infrastructure orchestration may provision dependencies, but schema-version ownership stays with the generated service's native migration tool.

