# WOW Frontend — source reuse security and provenance

Scope: [AppFactory #140](https://github.com/Trigenys/appfactory/issues/140)  
Prerequisite: [#139 source discovery contract](https://github.com/Trigenys/appfactory/issues/139)

## Ownership and trust boundaries

The existing `ui-registry/registry.json` remains the **Trigenys-owned native component catalog**. The external `wow-sources.json` is a **research and discovery inventory**, not a permission list to install code.

The separate `ui-registry/wow-review-policy.json` is the **centrally maintained approval policy**. The shipped policy has **zero approvals**, so no external components are authorized for reuse. A consumer's `.github/appfactory-frontend.json`, package metadata or generated manifest **cannot approve a source**.

Four dispositions are reported:

- `blocked` — missing source, invalid central policy or explicitly blocked source.
- `review-required` — source is listed but authoritative licensing is not yet verified.
- `reference-only` — source may inspire the design, but no code may be copied or installed.
- `approved` — an explicitly reviewed component + immutable commit has an approval entry; *this does not trigger a code transfer*.

All nine sources from #139 remain non-executable, non-installable and reference-only in the published inventory. The GitHub license metadata noted in the source catalog does not by itself authorize reuse.

## Approval checklist for maintainers

An approval can only be introduced by a reviewed change to `ui-registry/wow-review-policy.json`. Protect that file with branch protection/CODEOWNERS review as governance evolves; machine validation alone cannot attest that a license is authentic.

1. Verify authoritative **upstream LICENSE/COPYING text** at a specific 40-character Git commit SHA (not a branch or tag). Check whether a component uses different per-file licenses, assets, fonts, trademarks or paid/Pro restrictions.
2. Check the permitted use and notices for the **specific component**. A repository-level license may not cover bundled images, icon sets, Pro content or dependencies.
3. Record the original repository, exact SHA, SPDX identifier, GitHub URL ending in the upstream pinned `LICENSE`/`COPYING` file, reviewer and date.
4. Approve only necessary modes: `copy-adapt` and/or `registry-install`. For automation, account for transitive packages and lifecycle scripts separately; #140 **does not execute any installation**.
5. Record a `THIRD_PARTY_NOTICES.md` or `licenses/...` destination in the consumer. Confirm notices and adopted source files are actually committed, nonempty and accessible in the consumer checkout.
6. Re-review whenever the SHA, source component, permitted mode or destination files change. No silent provenance replacement.
7. Review screenshots and runtime behavior using the later visual QA workflow before release. The approval policy does not certify visual quality, browser support or performance.

The current policy explicitly allows only a narrow set of SPDX identifiers (`MIT`, `ISC`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`) **after human review**. This is a technical allowlist, not a legal determination of suitability. Licenses outside that set remain blocked pending a versioned policy decision.

## Security implementation

- `wow-security.mjs`: pure validation, decision, provenance reconciliation, checked-out-file verification and a conservative external-media URL detector.
- `wow-review-policy.json`: central, default-deny policy; **zero live approvals**.
- `schemas/wow-review-policy.schema.json`: review policy shape.
- `schemas/wow-provenance.schema.json`: consumer provenance shape.
- `test/wow-frontend-security.test.mjs`: malicious input, license state, approved fixture, pinning, no-op, collision, symlink escape and media tests.
- Existing CI `npm run test:ui-registry` runs the security tests alongside #139 contract tests.

Security checks reject unknown fields, attempt to smuggle install commands, owner/repo mismatches, mutable refs, unsupported modes, duplicate approvals, duplicate component records and unsafe paths. Sources classified as MCP tools or guidelines **cannot be used as component-code approvals**.

The review gate `assessWowAdoption()` always returns `executeAllowed: false`: even a synthetic test approval yields **eligibility for a manually reviewed adoption only**. No GitHub fetch, package installation, shell execution, copy operation, Cloudflare mutation or production deployment is performed by this feature.

## Deterministic consumer provenance

After an explicitly reviewed manual adoption, the consumer records:

```text
.appfactory/frontend-provenance.json
THIRD_PARTY_NOTICES.md     # or vetted file under licenses/
src/components/...         # the actual copied/adapted code
```

`reconcileWowProvenance(existing, request, inventory, trustedPolicy)` is a **pure function** that returns the updated JSON data; it does not write any files itself.

- Same component, SHA, mode, paths and review evidence → **no-op**, no duplicate record.
- Same component with a different SHA, path, license or review evidence → **hard conflict**, explicit migration/re-review required.
- Two adopted components claiming the same destination file → **hard conflict**.
- Missing or empty copied file / license notice → **failure**.
- Symlink leading outside the consumer checkout → **failure**.

The provenance contains source ID, upstream URL, exact SHA, component, SPDX, adoption mode, destination paths, notice path, reviewer and pinned license evidence. The consumer must commit the returned JSON with its code and notices. Do not confuse this new per-consumer file with the existing `ui-registry/provenance.json`, which records Trigenys-authored native components and remains untouched.

## Production hotlink review

`findExternalMediaHotlinks(text)` flags obvious external URLs for image formats like PNG, JPEG, WebP, AVIF, SVG and GIF. It does not treat ordinary WhatsApp links or local asset paths as hotlinks. It is a **source-text heuristic**, not a browser/network scanner; third-party image CDNs, CSS indirection and image loader libraries can still evade detection. The later #99 visual/QA pipeline must verify network resource provenance before release.

## Non-goals and follow-ups

This issue **does not grant approvals to any external repo**, nor does it change consumer configuration, existing AppFactory provisioning, the native UI Registry, component code, Project Automation or a running Cloudflare Worker.

- **#141**: agent skill calls the safe catalog and produces plans before generating UI.
- **#142**: adapter/compatibility implementation requires its own reviewed authorization boundary and may not treat eligibility as permission to execute.
- **Project Automation #99**: rendered validation and actual network image checks.

No subscription, paid component kit or additional cloud resource is required.
