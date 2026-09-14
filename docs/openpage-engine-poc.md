# OpenPage engine POC audit

Upstream: `buildingopen/openpage`
License: MIT (Copyright 2026 Federico De Ponte)

## Why it fits AppFactory

OpenPage is JSON-first: its AI endpoint accepts a prompt and returns a structured `SiteConfig` containing a theme and typed blocks. The upstream project currently exposes 19 block types and multiple variants, then renders or exports that config as a site.

This aligns with AppFactory's desired boundary:

```text
brief -> AppFactory orchestration -> OpenPage generation engine -> structured site config -> quality gate -> render/export -> GitHub -> Cloudflare
```

AppFactory should not copy OpenPage's prompt logic into the Worker. The Worker owns orchestration, safety/quality rules, repository lifecycle and deployment. OpenPage owns site composition and its block/rendering model.

## Upstream implementation notes

- AI endpoint: `POST /api/generate`
- request body: `{ "prompt": "..." }`
- upstream AI implementation currently uses Gemini and returns JSON
- `SiteConfig` is `{ name, pages?, blocks, theme? }`
- block types include navbar, hero, features, pricing, CTA, footer, testimonials, stats, FAQ, team, contact, newsletter, logo cloud, content, image, video, gallery, divider and banner
- OpenPage has a standalone HTML exporter, so the clean target integration is to expose render/export from a Trigenys-controlled OpenPage deployment instead of rebuilding its renderer inside AppFactory

## POC added to AppFactory

Runtime variables:

- `OPENPAGE_GENERATOR_URL` — base URL of a self-hosted OpenPage deployment, or the full `/api/generate` URL
- `OPENPAGE_API_TOKEN` — optional bearer token if the Trigenys deployment is protected

Endpoint:

```text
POST /engines/openpage/generate
```

The endpoint validates the normal AppFactory project request, builds a business-only prompt, calls OpenPage, validates the returned config and applies an AppFactory quality gate.

The quality gate removes evidence-sensitive blocks by default when the brief does not contain supporting data:

- testimonials
- customer/logo clouds
- statistics
- pricing

It also rejects output with no hero or no CTA/contact block.

## Deliberate limitation of this POC

`POST /projects` does not yet deploy OpenPage output. `engine: "openpage"` returns `OPENPAGE_POC_ONLY` until the renderer/export boundary is connected. This prevents AppFactory from silently claiming to use OpenPage while still deploying the native template.

## Next integration step

Create a Trigenys-controlled fork/deployment of OpenPage and add a render/export endpoint based on OpenPage's own `exportSiteToHTML` implementation. AppFactory can then:

1. call OpenPage generation,
2. quality-filter the `SiteConfig`,
3. call OpenPage render/export,
4. commit both `openpage.site.json` and the exported static site into the generated repository,
5. deploy that repository through the existing Cloudflare Pages pipeline.

Keep the upstream MIT copyright/license notice with substantial copied or modified OpenPage code.
