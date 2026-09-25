-- ============================================
-- Migration 006: Blind credential schemas (Postgres)
-- ============================================

CREATE TABLE IF NOT EXISTS blind_signature_requests (
  request_id TEXT PRIMARY KEY,
  voter_id TEXT NOT NULL,
  blinded_token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS issued_credentials (
  voter_id TEXT PRIMARY KEY,
  issued_at BIGINT NOT NULL
);
