# WOW Frontend source adapters and compatibility (issue #142)

Owner: `Trigenys/appfactory`. **This is a read-only recommendation system.** The actual consumer is responsible for UI code, and `EagleFox31/appfactory-project-automation` is responsible for future visual CI.

## How the catalogs fit together

| File | Role |
| --- | --- |
| `ui-registry/registry.json` | Already-shipped, Trigenys-authored native UI components; no change in #142 |
| `ui-registry/wow-sources.json` | Versioned external research inventory (#139) |
| `ui-registry/wow-review-policy.json` | Central default-deny source reuse policy (#140) |
| `ui-registry/wow-adapters.json` | #142 offline interface kinds and **possible** animation-runtime hints |
| `ui-registry/wow-resolver.mjs` | #142 deterministic, pure and fail-closed cross-source/stack decision function |
| `scripts/wow-frontend-plan.mjs` | #141 CLI, now includes `adapterResolutions` using #142 |

A second UI component registry is **not** created. The adapter file contains metadata, **not JavaScript commands**, component code, registry addresses, installation URLs, external tool credentials or secret references. In #142, there is no network access and **no tools are actually called**.

## Four technical outcomes

The resolver emits `decision` and `technicalFit` independently:

- `native`: a reviewed source's framework **and** styling assumptions match the consumer stack. This does **not** authorize automated import.
- `adapt`: the framework matches but styling differs (e.g. React/Vite plain CSS vs React/Tailwind component). A manual original adaptation to the consumer stack may be designed; do not automatically install Tailwind.
- `reference-only`: no centrally reviewed authorization, incompatible framework, guidance-only input or an optional external discovery tool. Research and design references only, no code copy.
- `unsupported`: a blocked/unknown source or invalid policy. Hard stop.

The `technicalFit` is a **nonbinding assessment**. A React/Tailwind entry may have `technicalFit: "adapt"` in React/Vite + CSS and still have `decision: "reference-only"` until centrally approved. Metadata-only license strings do not authorize source adoption.

## Source integration classes

- `external-tool`: 21st.dev Magic MCP — **optional service**, never a required dependency. The `connectedExternalTools` input is advisory only and does not trigger calls or installs.
- `component-pattern`: Magic UI, UI Layouts, beUI, React Bits, Animate UI and Motion Primitives Website — potential inspiration, with per-component dependency and license review.
- `registry-block`: Tailark marketing blocks — possible native pattern only when an actual compatible React/Tailwind consumer and an immutable license-approved source exist.
- `guidance`: Web Interface Guidelines — quality guidance, not executable component code.

The resolver covers **all nine** current source IDs. Every adapter has `executable:false` and `autoInstall:false`, and unknown adapters fail closed.

## Motion runtime handling

A source's `motionHints` are *possible dependencies of some upstream effects*; they are not audited component dependency manifests. Accepted hint tokens are `motion`, `gsap` and `three`, plus `none`.

Pass a list of **observed consumer-installed runtimes** to the resolver (from the consumer's actual `package.json`, not a guess). Returned `reuseExisting` entries indicate a runtime already present, and `needsDependencyReview` entries require per-component review before adding a new package. The resolver **never installs them**. For a plain-CSS product, choose native CSS animation when it can deliver the intent without increasing the bundle.

## Example — Commerce Factory

The existing Commerce Factory project uses React 19, Vite, TypeScript and its own CSS. It has real marketing imagery and FR/EN behavior. The planner's existing sample is:

```bash
node scripts/wow-frontend-plan.mjs \
  skills/wow-frontend/examples/commerce-factory.brief.json \
  ui-registry/examples/wow-react-vite-css.json
```

The returned report includes old research candidates (`sources`) and the new normalized `adapterResolutions`. For a Tailwind source such as Magic UI, the new technical fit is `adapt`; the **final decision stays `reference-only`**, with installation disallowed. The listed external guideline remains a reference.

This is a non-mutating planning example; the script has **not** edited Commerce Factory or rendered any screenshots.

## Security proof and next boundaries

All source selection is pure: no executable remote steps, `npm`/`npx`, `curl | sh`, new third-party package dependencies, code downloads, Cloudflare mutations or GitHub consumer writes. Central approval still requires #140's exact commit SHA, authoritative upstream license evidence, reviewer and preserved notice. Even an artificial approved fixture returns `actions.installAutomatically:false` and `actions.executeRemote:false`.

An approved source does not bypass the **consumer's own governance** or future #99 rendered QA. External tool invocation and any actual third-party code installation will require separate approved adapters and explicit permission in future work.

Run the existing `npm run test:ui-registry` and `npm run typecheck`. CI also smoke-builds the React/Vite blueprints through its existing Impact-Aware gates.

**Non-goals:** install Magic UI or Tailark, import React Bits code, run MagicPath/21st.dev, add Tailwind/GSAP/Three to Commerce Factory, build a new component registry, or claim rendered-browser evidence.
