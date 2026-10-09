# Motion — intentional, restrained, reversible

Animation is justified only when it clarifies hierarchy, explains product flow, demonstrates state change, connects cause and effect or directs attention to a useful CTA.

## Choose the least expensive tool

1. CSS transitions/keyframes for fades, hover/focus, subtle reveals and minor motion.
2. Existing consumer animation runtime if already present and genuinely needed.
3. A heavier library (Motion/GSAP/3D) only after a written rationale, dependency/license review and bundle/performance budget.

Do **not** install multiple overlapping motion runtimes. Keep hover-only effects decorative, never required to access content.

## Non-negotiable behavior

- Honor `@media (prefers-reduced-motion: reduce)`: content and CTA remain available; avoid motion-dependent navigation and offer static end states.
- No scroll-jacking, blocked scrolling or trapped focus.
- Avoid animating layout geometry that causes CLS; prefer opacity/transforms with measured impact.
- Avoid seizure-inducing flashing and relentless loops.
- Pause or stop long-running interactive motion when off-screen if necessary.
- Use clear touch/keyboard alternatives to pointer-hover interactions.
- On low-end phones test battery/runtime impact and input responsiveness.

## Commerce Factory example

A product card can visually transition to a storefront preview and then emphasize the WhatsApp CTA. All product information, pricing context and CTA must remain readable with **zero animation**. The design may show the prefilled product context *only if that behavior exists in the implemented flow*.

## Evidence

A text-only plan cannot establish animation performance. Record screenshots for static states, test reduced-motion mode in a real browser, inspect tab order and check measured CLS/LCP/TBT/INP where supported. If not tested, say **NOT VERIFIED**, not PASS.
