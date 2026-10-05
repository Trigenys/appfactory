# AppFactory engineering lessons

This file is the AppFactory-level RAIDER failure-memory log. Significant failures and near misses must produce a reusable prevention rule.

## 2026-09-24 — Android blueprint provisioning exceeded Worker subrequests

**What happened:** the first OIDC-authenticated GhostCall request created the repository and recovery marker, then AppFactory failed while materializing the Android blueprint because one Worker invocation exceeded the Cloudflare subrequest limit.

**Root cause:** materialization made one GitHub request to read each source blob and a second GitHub request to create each target blob. The per-file write requests doubled network fan-out.

**Why existing controls helped:** brownfield safety left `Trigenys/ghostcall` with `.appfactory/mobile-provisioning.json` marked incomplete, so the next successful invocation can resume the managed repository instead of overwriting or abandoning it.

**Fix:** keep source-blob reads, but send rendered file contents directly in one GitHub `Create a tree` request using each tree entry's `content` field. GitHub creates the blobs as part of that tree operation.

**Prevention rule:** blueprint materializers must batch Git object writes whenever an API supports bulk tree/content operations. Do not spend one external subrequest per target file when a single tree request can create the same blobs.

## 2026-09-24 — Markdown backticks in shell summary triggered command substitution

**What happened:** the provisioning workflow attempted to execute the event name `push` as a shell command while writing the GitHub Actions summary.

**Root cause:** Markdown backticks were embedded inside a double-quoted shell string, where backticks retain command-substitution semantics.

**Fix:** use `printf` with a single-quoted format string.

**Prevention rule:** GitHub Actions shell steps that emit Markdown must not place Markdown backticks inside double-quoted shell strings.


## 2026-10-05 — A configured secret is not proof that a requested profile exists

**What happened:** the first Editorial OS staging reconciliation proved that AppFactory had a non-empty `HYPERDRIVE_DATABASE_PROFILES` secret, but Hyperdrive provisioning still failed because the requested staging profile was absent or malformed. The original error merged both cases.

**Fix:** profile lookup now distinguishes an absent profile key from a malformed configured profile and reports only sorted profile names. Credential fields are never returned.

**Prevention rule:** health checks for structured secret registries must separate “registry configured” from “requested entry valid”. Diagnostics may expose non-sensitive keys, never credential values.
