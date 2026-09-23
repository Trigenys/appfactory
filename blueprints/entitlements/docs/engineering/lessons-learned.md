# Engineering lessons learned

Record meaningful failures and near misses here with context, root cause, resolution and a recurrence-prevention guardrail. This repository follows the RAIDER Failure Memory principle from the Trigenys Project Registry.

## 2026-09-23 — Reusable release startup failure in first generated service

**Context:** `Trigenys/entitlement-service`, the first repository generated from this blueprint, invoked the shared release workflow on its initial `main` commit.

**Failure:** GitHub reported `startup_failure` before the reusable release job started.

**Root cause:** this blueprint granted only `contents: write` and `pull-requests: write`, while `EagleFox31/appfactory-project-automation/.github/workflows/reusable-release.yml@v1` also requires `issues: write`.

**Resolution:** add `issues: write` to the generated caller workflow.

**Guardrail:** when a blueprint calls a reusable workflow, keep the caller permission set synchronized with the reusable workflow contract and validate the first generated repository end to end.

