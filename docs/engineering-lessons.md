# AppFactory engineering lessons

This file is the AppFactory-level RAIDER failure-memory log. Significant failures and near misses must produce a reusable prevention rule.

## 2026-11-04 — Stronger control: one shared blueprint materializer

**What happened:** after the desktop fix, `src/service-provisioning.ts` and `src/webapp-provisioning.ts` still posted one blob per file, the same latent Worker subrequest risk. Four copies of the materializer had drifted (inline content, binary lists, whitespace handling).

**Root cause:** each provisioning path owned a copy-pasted materializer, so a fix applied to one copy never reached the others (third occurrence of the same root cause).

**Fix:** `src/blueprint-materializer.ts` is the only materializer. Callers inject source, prefix, preset, path mapping, text renderer and extra files; text files travel inline in one tree request, only binary assets get a blob, base64 whitespace (not the letter `s`) is stripped.

**Prevention rule:** never re-implement Git tree materialization in a provisioning module. Guard: `test/blueprint-materializer-batching.test.mjs` (`npm run test:blueprint-batching`, core CI gate) executes the module against a mocked GitHub API, counts write subrequests, and fails if any provisioning path posts `/git/blobs` or `/git/trees` itself. It supersedes `test/desktop-blueprint-batching.test.mjs`.

**Generalized lesson:** when the same incident recurs across copies, extract the shared capability and guard every caller, instead of patching copies one by one.

## 2026-11-04 — Desktop blueprint provisioning exceeded Worker subrequests (repeat)

**What happened:** provisioning `Trigenys/claude-accounts-manager` (desktop `tauri-react`) created the repository and its recovery marker, then failed twice with "Too many subrequests by single Worker invocation".

**Root cause:** the 2026-09-24 Android fix (inline tree `content`) was applied to the mobile materializer only. `src/desktop-provisioning.ts` still posted one blob per file. A latent bug also stripped the letter `s` instead of whitespace from binary base64 (the regex literal was `/\\s+/g`).

**Fix:** text files are sent inline in the single tree request; only binary assets (icons) get their own blob, with whitespace correctly stripped.

**Prevention rule:** a fix for one materializer must be checked against every sibling materializer (desktop, mobile, service, webapp). Guard: `test/desktop-blueprint-batching.test.mjs` in CI. A repeated failure requires a stronger control: extract a shared materializer in a follow-up.

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

## 2026-10-26 — A product README edit is incomplete without a reusable quality contract

**Category:** architecture · documentation · reuse-first · automation

**What happened:** an attractive, security-focused README was written directly for AgentShield AI, but its structure, evidence rules and capability maturity guarantees were not available to other AppFactory products. Future repositories would still require the same manual fixes.

**Root cause:** product narrative quality had no reusable interface. Local prose editing was mistaken for improvement of the delivery platform.

**Resolution (proposed):** introduce a declarative Product README contract owned by AppFactory: deterministic rendering, a non-destructive plan/apply boundary, brownfield audit, an opt-in secretless workflow with immutable version pinning, and tests. Reuse Trigenys Engineering OS's canonical `technical-documentation` skill for authorship rather than duplicating editorial guidance.

**Prevention rule:** when a product-specific improvement reveals a repeatable cross-product need, create an independently adoptable contract at the owning platform layer. A product-specific README remains consumer-owned and is never silently overwritten. Claims about shipped capabilities require evidence; external security standards are design references, not certifications.

**Release boundary:** this PR adds the capability for review; no consumer is automatically migrated until the workflow is merged, pinned and tested on the existing consumer.


## 2026-10-26 — A content-valid README may still be visually generic

**What happened:** AppFactory passed its product README content contract for AgentShield, Aegis and VeriChain, but only AgentShield had a centered title, memorable one-line proposition, product-specific badges and useful section navigation. The presentation gap was visible directly on the GitHub repository front page.

**Root cause:** the original reusable contract modeled content completeness and maturity but not hero presentation, so the author manually styled one consumer and the others retained a generic Markdown introduction.

**Resolution:** add an optional, declarative presentation specification owned by AppFactory; implement a single renderer, exact audit of the marked hero, anchor validation and bounded updates of marked content only. Apply to different products with different copy and badges. Retain authored body content.

**RAIDER prevention rule:** declare visual documentation contracts when README consistency is a product requirement; validate the **actual output structure**, not just headings or keyword counts. Extend existing consumers through a non-destructive, explicit migration and independently tested shared module. Never equate a visually polished README with production capability or standards certification.


## 2026-11-04 — A blueprint-only runtime pin bypassed the gate that validates it

**Category:** CI · change-scoped execution · supply chain · non-regression

**What happened:** PR #179 moved `blueprints/react-vite/.github/workflows/project-automation.yml` to the reviewed Project Automation runtime v1.4.0 (`0523510a8e42290df3bae5749d034b1637569af5`, serialized bootstrap). AppFactory's own workflow, the other four blueprints and `test/project-automation-blueprints.test.mjs` stayed on `b1deb7b1069739879d7a4acb9cd3521bca835049`. Main looked green, then the next core change (PR #181) failed `typecheck` on an unrelated, pre-existing divergence.

**Root cause:** `.appfactory/ci-impact.json` routed `blueprints/react-vite/**` only to the `webapp` gate, while the shared pin contract runs in the `core` gate. A shared contract file was classified by its folder, not by the tests that consume it. The blueprint list in the contract test was also hard-coded and did not include AppFactory's own workflow.

**Classification:** process / CI routing gap (change-scoped execution too narrow), revealed by a partial runtime upgrade.

**Resolution:** the upgrade was intentional (upstream 1.4.0 adds a serialized bootstrap job with a per-repository concurrency group before item sync; the reusable workflow inputs are unchanged and the broker allows the new ref). AppFactory, all blueprints and the test constant now pin v1.4.0, and the six workflows are byte-identical.

**Prevention (verifiable):** every `project-automation.yml` (root and each blueprint) is listed explicitly in the `core` gate; `test/ci-impact.test.mjs` discovers those files on disk and fails if one is not routed to `core` or only reaches it by fallback; the blueprint contract test discovers blueprints on disk and requires AppFactory's own workflow to be identical to them.

**Generalized lesson:** route a file to every gate whose tests read it, not only to the gate that matches its folder. A runtime pin is a cross-cutting contract: upgrade it everywhere in one change, or not at all.
