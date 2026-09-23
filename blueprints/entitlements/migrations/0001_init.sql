PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS plan_entitlements (
  product_key TEXT NOT NULL,
  plan_key TEXT NOT NULL,
  feature_key TEXT NOT NULL,
  limit_value TEXT,
  metadata_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(product_key, plan_key, feature_key)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK(subject_type IN ('user', 'organization')),
  subject_id TEXT NOT NULL,
  product_key TEXT NOT NULL,
  plan_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'trialing', 'past_due', 'paused', 'canceled', 'expired')),
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(subject_type, subject_id, product_key)
);

CREATE TABLE IF NOT EXISTS device_activations (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE(subscription_id, device_id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  subject_type TEXT,
  subject_id TEXT,
  product_key TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_lookup
  ON subscriptions(subject_type, subject_id, product_key, status);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at
  ON audit_events(created_at);
