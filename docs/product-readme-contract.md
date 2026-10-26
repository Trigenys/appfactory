# RAIDER Product README Contract (v1)

**Owner:** AppFactory (project documentation lifecycle), **not** Project Automation (GitHub Project metadata) or Project Registry (portfolio inventory).

## Why this exists

A high-impact product README must communicate a concrete problem, the trust boundary or working architecture, capability maturity, testable milestones and honest limitations. A template alone is not enough: the words and evidence must be specific to the consumer project.

This is a **deterministic, offline, network-free** contract engine, not an AI writing service. Use the existing [Trigenys Engineering OS technical-documentation skill](https://github.com/Trigenys/trigenys-engineering-os/tree/main/skills/technical-documentation) to author project-specific narrative, then use this AppFactory contract to prevent incomplete or invented claims. No duplicated agent skills are introduced.

### Interfaces

- `scripts/product-readme-contract.mjs` exports `validateReadmeManifest`, `renderProductReadme`, `auditProductReadme` and `planReadmeCreation`.
- `--mode plan` computes **create**, **no-op** or **conflict**, without writing.
- `--mode apply` creates a README **only when absent**. It never overwrites an existing README, including one previously generated. Manual edits remain authoritative.
- `--mode audit` validates a brownfield README against a project-specific, declarative contract, without changing it.
- `.github/workflows/reusable-readme-quality.yml` is an opt-in, reusable, secretless GitHub Actions check. Pin both its `uses` reference and `appfactory_ref` to the **same immutable commit SHA** after promotion.

A consumer supplies its own narrative, accepted headings, evidence files, reference links and maturity status. AppFactory does not hardcode names, brands, repo owners or GitHub Project numbers.

## Example manifest

Store at `.appfactory/readme-contract.json`:

```json
{
  "schemaVersion": 1,
  "name": "Example Agent Security",
  "stage": "design",
  "tagline": "Enforce authorization at tool execution time, rather than trusting model predictions.",
  "problem": "An AI assistant can read untrusted external documents whose embedded instructions attempt to override the original user's approved intentions or privileges.",
  "scenario": "An invoice reader observes a hidden request to change account numbers, but its user granted only read access, so the tool gateway must refuse the external write.",
  "differentiation": "The gateway makes deterministic decisions from authenticated identity, exact tool action and resource scope. A model risk estimate cannot elevate denied privileges.",
  "architecture": "Authenticated user -> AI agent -> Proposed action -> Scoped policy gate -> Allow / Deny / Human approval -> Tool adapter -> Verifiable security event.",
  "limitations": "No detector can guarantee prevention of all attacks. Any tool execution path bypassing the gateway remains outside its protection boundary.",
  "capabilities": [
    {
      "name": "Policy boundary",
      "description": "Require explicit authorization for every privileged tool action.",
      "status": "planned"
    },
    {
      "name": "Audit verifier",
      "description": "Verify normalized event ordering with independently reproduced proofs.",
      "status": "in-development"
    }
  ],
  "roadmap": [
    {
      "name": "Security architecture",
      "exitCriteria": "Reviewed identity model, tool boundary and adversarial failure scenarios."
    },
    {
      "name": "Local policy MVP",
      "exitCriteria": "Repeatable allow/deny/approval test fixtures pass in CI."
    }
  ],
  "references": [
    {
      "name": "MITRE ATLAS",
      "url": "https://atlas.mitre.org/",
      "relevance": "Model adversarial behaviors for security testing."
    }
  ],
  "requiredHeadings": [
    "The problem",
    "How AgentShield is designed to work",
    "Security controls",
    "Delivery roadmap"
  ],
  "requiredTerms": ["OWASP", "deny"],
  "requiredFiles": ["docs/THREAT_MODEL.md"]
}
```

The example illustrates the contract. Headings and required terms are **consumer-defined**: configure them to match the actual existing README. The capability status `shipped` requires an evidence URL or path. The tool does not make a network request to assess external URL validity.

## Local use

```bash
node scripts/product-readme-contract.mjs --mode plan --manifest .appfactory/readme-contract.json --root .
node scripts/product-readme-contract.mjs --mode audit --manifest .appfactory/readme-contract.json --root .
node scripts/product-readme-contract.mjs --mode apply --manifest .appfactory/readme-contract.json --root .
node --test test/product-readme-contract.test.mjs
```

**Note:** `apply` is for an absent README only. For an existing README, use `audit` and improve the author-owned content through a reviewed PR. It deliberately does not rewrite custom GitHub profile, product or security documentation.

### Reusable GitHub Actions caller

After merging and promoting the AppFactory commit, substitute the same immutable 40-hex SHA in both locations:

```yaml
jobs:
  readme:
    uses: Trigenys/appfactory/.github/workflows/reusable-readme-quality.yml@<reviewed-40-character-commit-sha>
    with:
      manifest_path: .appfactory/readme-contract.json
      readme_path: README.md
      appfactory_ref: <the-same-reviewed-40-character-commit-sha>
```

The workflow has `contents: read`, does not mutate the consumer and needs no PAT or other secret.

## RAIDER assessment

- **Reusable:** contract-based, no AgentShield-specific logic.
- **Agnostic:** paths, names, headings and tech claims configured by consumers.
- **Idempotent:** plan/no-op; apply creates only when absent; audit is read-only.
- **Durable:** no changes to existing AppFactory provisioning or generated service contracts.
- **Engineering-grade:** honest capability maturity, explicit evidence, testable exit criteria, safe path resolution, pinned reusable workflow.
- **Retroactive:** any existing README can be audited without replacement.
- **Scoped CI:** this module's tests belong to core quality checks; unrelated mobile/desktop builds should not be triggered.
- **Reuse-first:** TEOS technical-documentation skill remains the canonical authoring guidance; this is a narrower enforcement component.

## Important limitations

A content contract checks structure, claimed maturity, referenced paths and specific terms; it cannot independently establish the truth of marketing claims, OWASP conformity or runtime security. Humans still review factual accuracy, copyright and product risks.

## Verified first-consumer pilot

The original open-source AgentShield README remains author-maintained. Its product-specific manifest and wrapper workflow live in [EagleFox31/agentshield-ai PR #6](https://github.com/EagleFox31/agentshield-ai/pull/6). The first read-only audit [completed successfully](https://github.com/EagleFox31/agentshield-ai/actions/runs/40298707488) against an immutable AppFactory feature-branch commit. That pilot does not prove the upstream PR has been released or that every future consumer will pass; merge and pin the reviewed AppFactory runtime first.

The module's test suite also exercises a different non-security product narrative (fulfillment operations) to verify that the renderer and auditor do not depend on AgentShield vocabulary or security-specific headings.
