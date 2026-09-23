interface D1Result<T = unknown> { success: boolean; results?: T[]; }
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}
interface Env {
  DB: D1Database;
  ADMIN_API_KEY: string;
  SERVICE_API_KEY: string;
  LICENSE_PRIVATE_KEY_PKCS8_B64?: string;
  LICENSE_PUBLIC_KEY_SPKI_B64?: string;
  ENVIRONMENT?: string;
}

type SubjectType = "user" | "organization";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Valid JSON object required.");
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, max = 200): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new Error(`${name} is required and must be at most ${max} characters.`);
  }
  return value.trim();
}

function subjectType(value: unknown): SubjectType {
  if (value !== "user" && value !== "organization") throw new Error("subjectType must be user or organization.");
  return value;
}

function bearer(request: Request): string {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

async function sameSecret(left: string, right?: string): Promise<boolean> {
  if (!left || !right) return false;
  const hash = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([hash(left), hash(right)]);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function auth(request: Request, secret?: string): Promise<Response | null> {
  return (await sameSecret(bearer(request), secret)) ? null : json({ error: "UNAUTHORIZED" }, 401);
}

function b64url(value: Uint8Array | string): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64buffer(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

async function sign(payload: string, env: Env): Promise<string> {
  if (!env.LICENSE_PRIVATE_KEY_PKCS8_B64) throw new Error("Offline signing is not configured.");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    b64buffer(env.LICENSE_PRIVATE_KEY_PKCS8_B64),
    { name: "Ed25519" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(payload));
  return `${b64url(payload)}.${b64url(new Uint8Array(signature))}`;
}

async function putCatalog(request: Request, env: Env): Promise<Response> {
  const denied = await auth(request, env.ADMIN_API_KEY); if (denied) return denied;
  const value = await body(request);
  const productKey = text(value.productKey, "productKey", 100);
  const planKey = text(value.planKey, "planKey", 100);
  if (!Array.isArray(value.features) || value.features.length === 0 || value.features.length > 200) {
    throw new Error("features must contain between 1 and 200 items.");
  }
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare("DELETE FROM plan_entitlements WHERE product_key = ? AND plan_key = ?").bind(productKey, planKey)
  ];
  for (const item of value.features) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Each feature must be an object.");
    const feature = item as Record<string, unknown>;
    statements.push(env.DB.prepare(
      "INSERT INTO plan_entitlements (product_key, plan_key, feature_key, limit_value, metadata_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(
      productKey,
      planKey,
      text(feature.key, "feature.key", 100),
      typeof feature.limit === "string" ? feature.limit.slice(0, 200) : null,
      feature.metadata === undefined ? null : JSON.stringify(feature.metadata),
      now
    ));
  }
  await env.DB.batch(statements);
  return json({ status: "APPLIED", productKey, planKey, features: value.features.length });
}

async function putSubscription(request: Request, env: Env): Promise<Response> {
  const denied = await auth(request, env.ADMIN_API_KEY); if (denied) return denied;
  const value = await body(request);
  const type = subjectType(value.subjectType);
  const id = text(value.subjectId, "subjectId");
  const productKey = text(value.productKey, "productKey", 100);
  const planKey = text(value.planKey, "planKey", 100);
  const status = typeof value.status === "string" ? value.status : "active";
  if (!["active", "trialing", "past_due", "paused", "canceled", "expired"].includes(status)) throw new Error("Invalid status.");
  const startsAt = typeof value.startsAt === "string" ? value.startsAt : null;
  const endsAt = typeof value.endsAt === "string" ? value.endsAt : null;
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO subscriptions (id, subject_type, subject_id, product_key, plan_key, status, starts_at, ends_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(subject_type, subject_id, product_key) DO UPDATE SET plan_key=excluded.plan_key, status=excluded.status, starts_at=excluded.starts_at, ends_at=excluded.ends_at, updated_at=excluded.updated_at"
  ).bind(crypto.randomUUID(), type, id, productKey, planKey, status, startsAt, endsAt, now, now).run();
  await env.DB.prepare(
    "INSERT INTO audit_events (id, event_type, subject_type, subject_id, product_key, payload_json, created_at) VALUES (?, 'subscription.upserted', ?, ?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), type, id, productKey, JSON.stringify({ planKey, status, startsAt, endsAt }), now).run();
  return json({ status: "UPSERTED", subjectType: type, subjectId: id, productKey, planKey });
}

async function activeSubscription(env: Env, type: SubjectType, id: string, productKey: string) {
  const now = new Date().toISOString();
  return env.DB.prepare(
    "SELECT id, plan_key, ends_at FROM subscriptions WHERE subject_type=? AND subject_id=? AND product_key=? AND status IN ('active','trialing') AND (starts_at IS NULL OR starts_at<=?) AND (ends_at IS NULL OR ends_at>?) LIMIT 1"
  ).bind(type, id, productKey, now, now).first<{ id: string; plan_key: string; ends_at: string | null }>();
}

async function check(request: Request, env: Env): Promise<Response> {
  const denied = await auth(request, env.SERVICE_API_KEY); if (denied) return denied;
  const value = await body(request);
  const type = subjectType(value.subjectType);
  const id = text(value.subjectId, "subjectId");
  const productKey = text(value.productKey, "productKey", 100);
  const featureKey = text(value.featureKey, "featureKey", 100);
  const subscription = await activeSubscription(env, type, id, productKey);
  if (!subscription) return json({ allowed: false, reason: "ACTIVE_SUBSCRIPTION_NOT_FOUND" });
  const entitlement = await env.DB.prepare(
    "SELECT limit_value, metadata_json FROM plan_entitlements WHERE product_key=? AND plan_key=? AND feature_key=? LIMIT 1"
  ).bind(productKey, subscription.plan_key, featureKey).first<{ limit_value: string | null; metadata_json: string | null }>();
  if (!entitlement) return json({ allowed: false, reason: "FEATURE_NOT_INCLUDED", planKey: subscription.plan_key });
  return json({
    allowed: true,
    planKey: subscription.plan_key,
    featureKey,
    limit: entitlement.limit_value,
    metadata: entitlement.metadata_json ? JSON.parse(entitlement.metadata_json) : null,
    expiresAt: subscription.ends_at
  });
}

async function offlineGrant(request: Request, env: Env): Promise<Response> {
  const denied = await auth(request, env.SERVICE_API_KEY); if (denied) return denied;
  const value = await body(request);
  const type = subjectType(value.subjectType);
  const id = text(value.subjectId, "subjectId");
  const productKey = text(value.productKey, "productKey", 100);
  const deviceId = text(value.deviceId, "deviceId");
  const subscription = await activeSubscription(env, type, id, productKey);
  if (!subscription) return json({ error: "ACTIVE_SUBSCRIPTION_NOT_FOUND" }, 403);
  const rows = await env.DB.prepare(
    "SELECT feature_key, limit_value, metadata_json FROM plan_entitlements WHERE product_key=? AND plan_key=? ORDER BY feature_key"
  ).bind(productKey, subscription.plan_key).all<{ feature_key: string; limit_value: string | null; metadata_json: string | null }>();
  const iat = Math.floor(Date.now() / 1000);
  const requestedTtl = typeof value.ttlSeconds === "number" ? Math.floor(value.ttlSeconds) : 86400;
  let exp = iat + Math.min(Math.max(requestedTtl, 300), 604800);
  if (subscription.ends_at) exp = Math.min(exp, Math.floor(new Date(subscription.ends_at).getTime() / 1000));
  if (exp <= iat) return json({ error: "SUBSCRIPTION_EXPIRED" }, 403);
  const payload = JSON.stringify({
    v: 1, jti: crypto.randomUUID(), iss: "__SERVICE_SLUG__",
    sub: `${type}:${id}`, product: productKey, plan: subscription.plan_key,
    device: deviceId, iat, exp,
    features: (rows.results || []).map((row) => ({
      key: row.feature_key,
      limit: row.limit_value,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null
    }))
  });
  const grant = await sign(payload, env);
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO device_activations (id, subscription_id, device_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(subscription_id, device_id) DO UPDATE SET last_seen_at=excluded.last_seen_at"
  ).bind(crypto.randomUUID(), subscription.id, deviceId, now, now).run();
  return json({ grant, algorithm: "Ed25519", expiresAt: new Date(exp * 1000).toISOString() }, 201);
}

async function route(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/health") return json({ status: "ok", service: "__SERVICE_SLUG__", schemaVersion: 1 });
  if (request.method === "GET" && path === "/.well-known/entitlement-public-key") {
    return env.LICENSE_PUBLIC_KEY_SPKI_B64
      ? json({ algorithm: "Ed25519", format: "spki-base64", key: env.LICENSE_PUBLIC_KEY_SPKI_B64 })
      : json({ error: "OFFLINE_GRANTS_NOT_CONFIGURED" }, 404);
  }
  if (request.method === "PUT" && path === "/v1/admin/catalog") return putCatalog(request, env);
  if (request.method === "PUT" && path === "/v1/admin/subscriptions") return putSubscription(request, env);
  if (request.method === "POST" && path === "/v1/entitlements/check") return check(request, env);
  if (request.method === "POST" && path === "/v1/offline-grants/issue") return offlineGrant(request, env);
  return json({ error: "NOT_FOUND" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return await route(request, env); }
    catch (error) {
      console.error("Entitlement service request failed", error);
      const message = env.ENVIRONMENT === "production" ? "Request failed." : error instanceof Error ? error.message : "Request failed.";
      return json({ error: "REQUEST_FAILED", message }, 400);
    }
  }
};
