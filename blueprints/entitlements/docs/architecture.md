# Architecture

## Boundary

The Entitlement Service answers one product question: **is this subject entitled to this product feature right now?**

It owns plan-feature grants, subscriptions, device activations and entitlement audit events. It does not own authentication, payment collection or application business logic.

## Trust model

- Product backends call `/v1/entitlements/check` with `SERVICE_API_KEY`.
- Admin/billing automation changes catalog and subscriptions with `ADMIN_API_KEY`.
- Desktop/mobile clients must never embed either server secret.
- Offline clients receive short-lived Ed25519-signed grants. Clients verify with the public key; only the service holds the private key.
- UI checks are convenience only. Protected backend operations must evaluate entitlements server-side.

## Storage

MVP uses Cloudflare D1 behind the Worker binding `DB`. SQL is isolated to the service boundary so the persistence layer can be moved later without changing consumer-facing entitlement contracts.

## Offline grants

`POST /v1/offline-grants/issue` signs a compact `base64url(payload).base64url(signature)` grant. Maximum TTL is seven days and is also capped by the subscription expiry. Device identifiers are recorded for activation visibility, not treated as unforgeable hardware identity.

## Delivery

AppFactory owns infrastructure bootstrap for this preset:

```text
GitHub repository
      ↓
D1 database
      ↓
wrangler.jsonc receives real database UUID
      ↓
Cloudflare Worker bootstrap
      ↓
native Workers Builds connection
      ↓
npm run d1:migrate:remote
      ↓
wrangler deploy
```

Wrangler remains the migration authority so the service keeps Cloudflare's native `d1_migrations` bookkeeping. AppFactory does not implement a parallel SQL migration tracker.

Runtime product secrets are deliberately outside automatic generation. They are configured after infrastructure bootstrap and remain Worker secrets.

