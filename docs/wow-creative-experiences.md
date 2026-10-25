# WOW creative experiences — curated research (2026-10-25)

Creative direction references for Trigenys AppFactory and Commerce Factory. **Not templates to clone**. Catalogued in `ui-registry/wow-sources.json` with kind `experience`; matching adapters remain non-executable and reference-only. No source is centrally approved for code reuse. GitHub metadata is **not** a license audit; third-party images/fonts/3D models need independent verification.

## Art directions (do not mix these into one generic SaaS layout)

| Reference | Direction | Suggested original Trigenys composition | Consumer |
|---|---|---|---|
| LN landing-pages | Narrative scene layouts, botanical/3D, editorial depth | Spatial product stage with restrained animation | AppFactory / Commerce Factory |
| FizziFresh | Product-directed scroll storytelling, focal object transitions | Cinematic Product Story, no copied source or brand | Commerce Factory |
| David Heckhoff | Light 3D, shaders, experimental portfolio | Layered gallery windows + intentional interaction | AppFactory |
| Giats portfolio | Fluid overlays, 3D background and layered windows | Pointer-responsive art gallery built originally | AppFactory |
| Wibe Studio | Fashion photography and full-bleed editorial pacing | Fashion Editorial / photographic lookbook | Commerce Factory |
| NOCTIS | Audio-reactive generative art and interactive scenes | Creative Studio / Lab, optional motion | AppFactory |
| Codrops Pixel Gallery | WebGL reveal and image-to-detail journeys | Media gallery image transition | AppFactory |
| Codrops Interlude | Page-to-page narrative transitions | Distinct transition recipes | AppFactory |

## Safe integration sequence

1. Capture the real consumer stack and product constraints; do not migrate Commerce Factory away from React/Vite + CSS.
2. Define original art direction, section sequence, typography and asset rights; gather truthful product material.
3. Design a native component in a consumer feature branch. Use existing CSS/JS before considering GSAP, Three.js or a new framework.
4. Start with an isolated route / preview; do not mutate merchant theme IDs, DB constraints, checkout, tenant data or published storefronts.
5. Prove 320/390/1440px, keyboard, reduced-motion, FR/EN, loading failure, truthful pricing and functional CTAs, plus build and existing journeys.
6. Promote to `ui-registry/registry.json` only for original audited reusable code. Upstream screenshots are visual research, not source files to mirror.

## First consumer experiment

Commerce Factory: `/labs/cinematic-product-story` (fictional products and self-hosted sample art). It must remain a **preview-only** feature until visual review, performance measurements, approval of product media, and backward-compatible tenant/theme migration planning. It must not appear as an activated merchant theme or count toward production theme IDs.

This classification is deliberately stronger than `block`: whole experience references are never eligible to turn into installable component code, even under a future manual source approval. Implement the **principles**, not the upstream source.
