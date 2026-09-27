-- ============================================
-- Rollback migration 007: Multi-tenant resource isolation & audit trail backfill
-- ============================================

-- Drop indexes added in up migration
DROP INDEX IF EXISTS idx_events_tenant;
DROP INDEX IF EXISTS idx_payment_jobs_tenant;
DROP INDEX IF EXISTS idx_transaction_log_tenant;
DROP INDEX IF EXISTS idx_audit_log_tenant;

-- Preserve payment_jobs rows by renaming rather than dropping; the original
-- up migration created this table from scratch so there is no pre-007 schema
-- to restore, but destroying live tenant data on rollback is unacceptable.
-- The renamed table can be inspected or dropped manually after verifying no
-- in-flight jobs remain.
ALTER TABLE IF EXISTS payment_jobs RENAME TO payment_jobs_rollback_007;

-- Reverse the tenant_id columns added to audit_log, transaction_log, events.
-- SQLite 3.35+ supports DROP COLUMN; on older engines this is a no-op that
-- leaves the column in place (harmless — it just won't be used).
ALTER TABLE audit_log DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE transaction_log DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE events DROP COLUMN IF EXISTS tenant_id;
