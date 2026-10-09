# Trigenys UI Registry — MVP (v1)

This is a **Trigenys-authored, audited, zero-runtime-dependency** UI source registry.
It intentionally does **not** mirror 21st.dev, Magic UI or external component code.

## How to use

AppFactory `POST /projects` can opt into one of four brand directions when provisioning
a **new** React/Vite webapp:

```json
{
  "name": "Shop Demo",
  "slug": "shop-demo",
  "projectType": "webapp",
  "preset": "react-vite",
  "uiProfile": "tech-commerce-premium"
}
```

Available profiles: `editorial-lifestyle-premium`, `tech-commerce-premium`,
`professional-service-premium`, `academic-institutional-premium`.

The request provisions reviewed source for `UiButton`, `UiCard`, `WhatsAppCta`
and their stylesheet directly into the generated repository. It replaces the demo
App and CSS with a chosen theme, adding `uiProfile` and `uiRegistryVersion` to the
generated marker. Requests without `uiProfile` preserve the original minimal blueprint.
Already-provisioned repositories are **not** overwritten to change their theme.

`registry.json` is a shadcn-style authoring catalog. A public, built `/r/*.json`
HTTP endpoint / official CLI and MCP integration **has not yet been published**.
The current supported consumption path is AppFactory provisioning only.

## Rules

- Every new item must have source, ownership, explicit license and dependency record.
- Never scrape or copy third-party marketplace code or previews automatically.
- Update token definitions in `profiles.json` and ensure mobile/focus/reduced-motion checks.
- Test in a generated React 19/Vite app before claiming full compatibility.
- OpenPage already has its own **page-block renderer**; this source registry is a distinct
  distribution layer, not an OpenPage replacement.
- WhatsAppCta expects the merchant's explicit international telephone number.
  Never publish a fake number in a storefront.
- Run `npm run test:ui-registry` in AppFactory before release.

## Status

P0 source/provisioning integration. Visual regression, independently built registry
endpoint, full shadcn CLI support and OpenPage adapter are follow-ups.


## WOW Frontend external discovery contract (v1, opt-in)

The existing `registry.json` is the **only native component catalog** and remains unchanged.

- `wow-sources.json` is a separate, reviewed **external source metadata inventory**, not a second UI component registry.
- `schemas/wow-sources.schema.json` and `schemas/wow-consumer.schema.json` define the versioned data contracts.
- `wow-contract.mjs` validates both contracts deterministically with built-in Node.js APIs, no third-party dependencies or network calls.
- `examples/wow-react-vite-css.json` shows a read-only/opt-in config appropriate for brownfield React/Vite + plain CSS.
- `test/wow-frontend-contract.test.mjs` is executed by the existing `npm run test:ui-registry` CI gate.

Read-only validation:

```bash
node ui-registry/wow-contract.mjs
node ui-registry/wow-contract.mjs ui-registry/examples/wow-react-vite-css.json
npm run test:ui-registry
```

A consumer may eventually store the documented contract as `.github/appfactory-frontend.json`; this initial release **does not** provision from that file, install packages, copy third-party code, authenticate to 21st.dev/MagicPath, or change the consumer stack.

**Source inventory policy:** all external source entries in v1 have `reuse: "reference-only"` and `executionAllowed: false`. SPDX values with `verification: "metadata-only"` describe GitHub metadata, **not permission to import code**. Missing/unverified licensing is also reference-only. Later implementation issues #140 and #142 must explicitly review terms, immutable refs, provenance and adapters before introducing adoption.

When selecting inspiration for a plain-CSS React/Vite project, a Tailwind source is marked `adaptation-reference` and remains **non-installable**. Non-React projects receive a design reference only. This metadata classification is not a production compatibility certification.

The existing `uiProfile` provisioning path and `registry.json` files remain authoritative and are not modified by WOW research mode.
