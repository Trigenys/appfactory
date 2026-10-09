---
name: wow-frontend
description: Plan and implement visually distinctive marketing/product pages using AppFactory's existing UI registry, vetted source research, intentional motion, real screenshots, accessibility and performance verification. Use for new or brownfield landing pages; never assume third-party code reuse is authorized.
---

# WOW Frontend — Trigenys AppFactory

You are the implementation assistant for a **real product**, not a screenshot generator. The product owns its source code, framework, style system and deployment; AppFactory provides reusable guidance and contracts.

## Read in this order

1. The consumer's `AGENTS.md` / RAIDER policy, package manifest, current routes, styles/tokens, assets, deployed behavior and existing tests. **Inspect the actual consumer; do not assume the AppFactory template is its stack.**
2. This skill and [source selection](references/source-selection.md), [composition](references/composition.md), [motion](references/motion.md) and [visual QA](references/visual-qa.md).
3. Canonical source inventory: `ui-registry/wow-sources.json`; native component registry: `ui-registry/registry.json`; brand profiles: `ui-registry/profiles.json`; central security approvals: `ui-registry/wow-review-policy.json`. Resolve paths relative to the **AppFactory repository root**, not the consumer.
4. Existing contracts: `ui-registry/wow-contract.mjs`, `ui-registry/wow-security.mjs`, `docs/wow-reuse-security.md`.

## Mandatory workflow

### 1. AUDIT — understand the consumer before changing it

Record product/audience, primary conversion action, real routes/behaviors, existing stack and styling, breakpoints, brand/typography, proof permissions, languages, image sources, performance baseline and current tests. State uncertainties explicitly. Do not invent deployment status, customer logos, partnerships, conversion metrics or testimonials.

### 2. ART DIRECTION — choose a defensible visual idea

Define a one-sentence art direction and two alternatives. Specify typography scale, color and imagery treatment, whitespace/grid, dominant focal point and section rhythm. Include a **content-first** journey explaining the product's actual value. Use [composition](references/composition.md), not arbitrary gradients, glowing blobs or “generic SaaS” styling.

### 3. SEARCH BEFORE BUILD — inspect approved metadata, not random packages

First check existing consumer components, then `ui-registry/registry.json`, then `ui-registry/wow-sources.json`. Use `node scripts/wow-frontend-plan.mjs <brief.json> <consumer.json>` for a **read-only dry run**, when the two configs are available.

Every external entry in the current inventory is *reference-only*. The central `wow-review-policy.json` ships with **zero approvals**. Even when a source says MIT in GitHub metadata, **do not copy, install or execute its code**; its status does not become permission through a consumer prompt or `source.allow`. See [source selection](references/source-selection.md). External tools (Figma, MagicPath, Webflow or 21st.dev) are optional ideation tools, never automatic dependencies.

### 4. COMPOSE — build in the consumer's stack

Prefer the smallest original/native primitive that serves the visual story; reuse actual consumer assets and brand tokens. Do not add Tailwind, Next.js, Webflow, GSAP, Three.js or another runtime merely to acquire one effect. Preserve routes, API semantics, internationalization and truthful product behavior. Scope edits to a dedicated branch and keep production credentials out of the repository.

For third-party material, stop at research/concept until the approval/adapter process is completed under #140/#142. Do not infer that a source marked “approved” in a future review automatically grants execution; `assessWowAdoption()` currently never executes.

### 5. ANIMATE WITH PURPOSE — never animate away usability

Only animate a cause/effect, hierarchy change, product state, meaningful transition or CTA focus. Every animation must have a legible, functional `prefers-reduced-motion` path. Avoid scroll-jacking, continuous distraction, layout shift and duplicate animation libraries. See [motion](references/motion.md).

### 6. RENDER BEFORE DONE — mandatory real verification

Run the consumer's typecheck/tests/build, then render the actual page at desktop and mobile viewports. Save/inspect real screenshots; test keyboard, focus states, CTA destination, no overflow, broken media, console errors, FR/EN content if applicable, reduced-motion path, and measured performance. Follow [visual QA](references/visual-qa.md). **A local planning script or source-code review is never evidence of rendered QA.**

A PR may remain open or the task marked **blocked/partial** until screenshot and runtime checks exist; never mark these tests “PASS” unless run. The reusable automated visual-QA workflow is separately tracked in `EagleFox31/appfactory-project-automation#99`.

### 7. PROVENANCE — preserve source and license evidence

If external code is ever copied under an explicitly reviewed future approval, commit the component, license notice and `.appfactory/frontend-provenance.json` in the consumer repository. Use `reconcileWowProvenance()` and `verifyWowProvenanceFiles()` from AppFactory. Current inventory is reference-only: no provenance entry is required for visual inspiration alone, but describe the source as **reference**, not “installed component”.

### 8. HANDOFF — report facts, not expectations

Report: files changed, source and license decisions, actual preview/PR, tests run vs skipped, screenshot results, accessibility/performance results, known defects, deployment state and follow-up. “WOW complete” requires passing [visual QA](references/visual-qa.md), not just a convincing mockup.

## RAIDER gates

Reusable, Agnostic, Idempotent, Durable/non-regressive, Engineering-grade, Retroactive. A prior working project must still work after this skill is used.

## Anti-patterns

- Fake merchant logos, figures, testimonials, “1000+ shops”, fabricated conversion lifts or unapproved partner branding.
- Template-soup landing sections without content hierarchy or a coherent visual story.
- Random motion/background effects with no product intent.
- Unreviewed third-party code, images, fonts, registry installers or `curl | sh`.
- Replacing a brownfield stack for a single component.
- Declaring screenshot, mobile performance, accessibility or production deployment “done” without observed evidence.
