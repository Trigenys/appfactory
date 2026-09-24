# Mobile project blueprints

AppFactory provisions reusable mobile repositories through `projectType: "mobile"`.

The first supported platform/preset pair is Android with Jetpack Compose:

```http
POST /projects
Content-Type: application/json

{
  "name": "GhostCall",
  "slug": "ghostcall",
  "projectType": "mobile",
  "platform": "android",
  "preset": "android-compose",
  "private": true
}
```

The repository is created directly in the configured GitHub organization and then materialized from `blueprints/android-compose/`. It does not use the landing-page template or Cloudflare infrastructure.

The generated baseline includes Compose UI foundations, CI, AppFactory Project Automation, RAIDER engineering instructions and Roborazzi visual-regression support.

Project Automation is zero-PAT by default. Generated repositories call the reusable AppFactory workflow with GitHub Actions OIDC and the hosted Project broker; no `PROJECT_TOKEN`, OAuth client secret or encryption key is copied into the repository. Private Trigenys repositories rely on the broker owner's one-time private-repository OAuth authorization rather than per-repository credentials.

`android/nowinandroid` is an architectural reference, not a runtime dependency. `android/compose-samples` is a pattern reference. Roborazzi is the deliberate visual-regression dependency embedded in generated repositories.

A valid `.appfactory/mobile.json` marker makes repeated provisioning idempotent. An unrelated repository with the same slug is never overwritten.

Release signing keys and Play Console credentials are intentionally not created or copied by AppFactory.
