-- ============================================
-- Migration 007: Multi-tenant resource isolation & audit trail backfill (Postgres)
-- ============================================

-- 1. Add tenant_id to audit_log and backfill NULL audit entries
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS tenant_id TEXT DEFAULT 'default';
UPDATE audit_log SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE audit_log SET prev_hash = '0000000000000000000000000000000000000000000000000000000000000000' WHERE prev_hash IS NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON audit_log(tenant_id);

-- 2. Add tenant_id to transaction_log
ALTER TABLE transaction_log ADD COLUMN IF NOT EXISTS tenant_id TEXT DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_transaction_log_tenant ON transaction_log(tenant_id);

-- 3. Create payment_jobs with hash PK and amount BigInt
CREATE TABLE IF NOT EXISTS payment_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  amount BIGINT NOT NULL DEFAULT 0,
  ops TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_payment_jobs_tenant ON payment_jobs(tenant_id);

-- 4. Add tenant_id to events
ALTER TABLE events ADD COLUMN IF NOT EXISTS tenant_id TEXT DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_events_tenant ON events(tenant_id);
