# Reusable private R2 provisioning

Status: supported AppFactory infrastructure recipe  
Related: #124

## Purpose

Existing Trigenys repositories can request one deterministic private Cloudflare R2 bucket without receiving Cloudflare account credentials.

The first recipe is `private-media`, intended for product/store media and similar application-owned objects.

## Request

Canonical AppFactory infrastructure workflows call:

`POST /infrastructure/r2`

with their GitHub Actions OIDC token and:

```json
{
  "repository": "Trigenys/example-webapp",
  "recipe": "private-media"
}
```

The request cannot choose a bucket name, account, public domain or access key.

## Deterministic resource

AppFactory derives:

`<repository-name>-media`

For example:

`Trigenys/trigenys-commerce-factory`
→ `trigenys-commerce-factory-media`

The operation is idempotent. An existing bucket with that deterministic name is reused.

## Privacy boundary

The bucket is not made public.

AppFactory reads the bucket's managed `r2.dev` domain state and explicitly disables it when enabled. Product applications serve authorized/public objects through their own Worker routes or a later reviewed delivery layer.

AppFactory never returns R2 access credentials.

## Worker binding contract

The product Worker binds the bucket in its reviewed Wrangler config:

```jsonc
{
  "r2_buckets": [
    {
      "binding": "MEDIA_BUCKET",
      "bucket_name": "example-webapp-media"
    }
  ]
}
```

The reusable AppFactory endpoint creates the Cloudflare resource. The repository remains responsible for its product-specific object key policy, MIME/size validation, upload authorization, public serving routes and lifecycle behavior.

## Security

The endpoint reuses the existing infrastructure OIDC boundary:

- Trigenys repository;
- protected `main`;
- exact canonical infrastructure workflow identity;
- repository claim must equal the request repository.

Required AppFactory Cloudflare permission:

- `Workers R2 Storage Edit`.

Permission errors return only the permission requirement; Cloudflare token values are never returned or logged.

## First consumer

Commerce Factory uses this recipe for product/store images. Its application object keys are namespaced by tenant, for example:

`stores/{storeId}/products/{productId}/{imageId}.webp`
