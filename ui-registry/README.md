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
