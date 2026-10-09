# Source selection — search before build

## Source-of-truth order

1. The consumer's existing components and design system (first).
2. Native Trigenys components in `ui-registry/registry.json`, whose provenance is recorded in `ui-registry/provenance.json`.
3. External **research inventory** in `ui-registry/wow-sources.json`; consult `ui-registry/wow-review-policy.json` for centralized decisions.
4. Only then consider a new original component.

Do **not** create a second shadcn registry; `wow-sources.json` is metadata for research, not installable `registry.json` items.

## Resolve the existing contracts

From the AppFactory repository root:

```sh
node ui-registry/wow-contract.mjs
node scripts/wow-frontend-plan.mjs skills/wow-frontend/examples/commerce-factory.brief.json ui-registry/examples/wow-react-vite-css.json
```

A plan is **read-only** and uses repository-pinned metadata; it does not crawl GitHub or produce code. Invalid source IDs, permissions, malformed configs and unknown fields must fail closed. Treat the result as a candidate list for further review, never as a tested compatibility guarantee.

## Distinguish status from technical fit

- `blocked`: unknown, explicitly denied or policy invalid; do not use.
- `review-required`: missing authoritative license evidence; inspect only as a conceptual reference.
- `reference-only`: catalogued for inspiration; **no code copy, install or execution**.
- `approved`: a *specific* source commit/mode reviewed centrally; still requires downstream adapter, provenance and consumer review. Never interpret this as a shell execution permit.

The current central policy has **zero approvals** and the published inventory disables all external execution.

The existing planner's `native-reference`, `adaptation-reference` and `design-reference` labels describe **research fit only**. A Tailwind reference for React/Vite + plain CSS is a cue to recreate *original styling* in the existing stack, not to paste upstream snippets or add Tailwind.

## Approval and licensing

Before copying external code or assets in a future phase: identify the exact upstream 40-character commit SHA, authoritative LICENSE/COPYING file at that SHA, per-component and paid/Pro exceptions, transitive dependencies and licenses, required notices, acceptable modes, reviewer and review date. Record a central review in `wow-review-policy.json`; run `assessWowAdoption()` without bypassing any rejection. See `docs/wow-reuse-security.md`. This skill alone cannot approve sources.

Never fetch/execute remote install scripts or silently run `npx` from a README. Never hotlink unlicensed product photography or reuse trademarked merchant branding without permission.

## Decision output

For each considered primitive capture:

- the actual UX problem it solves;
- native/current component vs external source ID;
- framework/styling compatibility and runtime cost;
- legal status / evidence and required notices;
- use mode (`existing-native`, `original-reimplementation`, or `research-only`);
- reason for rejection/adoption;
- impact on responsive layout, reduced motion, accessibility and bundle size.
