# Desktop project blueprints

AppFactory supports native Windows desktop repositories through:

```json
{
  "projectType": "desktop",
  "platform": "windows",
  "preset": "tauri-react"
}
```

## Baseline

The `tauri-react` preset creates a private-by-default repository with:

- Tauri 2
- React + TypeScript + Vite
- Rust command boundary for privileged filesystem and native operations
- GitHub Actions CI
- AppFactory Project Automation using the zero-PAT OIDC broker contract
- a versioned AppFactory marker under `.appfactory/desktop.json`

The renderer intentionally does not grant broad filesystem access to the frontend WebView. Product-specific native access should be implemented as narrow Rust commands and reviewed as part of the product threat model.

## Provisioning contract

Example request:

```json
{
  "name": "Desktop Product",
  "slug": "desktop-product",
  "projectType": "desktop",
  "platform": "windows",
  "preset": "tauri-react",
  "private": true,
  "description": "Windows desktop application"
}
```

AppFactory creates the repository, claims provisioning with `.appfactory/desktop-provisioning.json`, materializes the versioned blueprint, and returns the repository and commit SHA.

Replaying the same request against a repository already managed by the same blueprint is idempotent.

## Ownership

AppFactory owns the reusable scaffold and managed Project Automation contract.

The generated repository owns product architecture, domain code, product documentation, UX, release policy and any additional native permissions.
