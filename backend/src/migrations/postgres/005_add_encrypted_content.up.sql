-- ============================================
-- Migration 005: E2E encrypted governance content (Postgres)
-- ============================================

CREATE TABLE IF NOT EXISTS dao_group_keys (
  dao_id BIGINT NOT NULL,
  epoch BIGINT NOT NULL,
  threshold INTEGER NOT NULL,
  member_count INTEGER NOT NULL,
  key_commitment TEXT NOT NULL,
  rotation_reason TEXT NOT NULL CHECK(rotation_reason IN (
    'genesis', 'member_joined', 'member_left', 'member_revoked', 'manual'
  )),
  active SMALLINT NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  PRIMARY KEY (dao_id, epoch)
);

CREATE INDEX IF NOT EXISTS idx_dao_group_keys_active
  ON dao_group_keys(dao_id, active, epoch DESC);

CREATE TABLE IF NOT EXISTS dao_key_wraps (
  dao_id BIGINT NOT NULL,
  epoch BIGINT NOT NULL,
  member_id TEXT NOT NULL,
  wrapped_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  PRIMARY KEY (dao_id, epoch, member_id)
);

CREATE INDEX IF NOT EXISTS idx_dao_key_wraps_member
  ON dao_key_wraps(dao_id, member_id);

CREATE TABLE IF NOT EXISTS dao_recovery_shares (
  dao_id BIGINT NOT NULL,
  epoch BIGINT NOT NULL,
  share_index INTEGER NOT NULL CHECK(share_index BETWEEN 1 AND 255),
  wrapped_share TEXT NOT NULL,
  PRIMARY KEY (dao_id, epoch, share_index)
);

CREATE TABLE IF NOT EXISTS encrypted_content (
  dao_id BIGINT NOT NULL,
  content_type TEXT NOT NULL CHECK(content_type IN ('proposal', 'comment')),
  content_id BIGINT NOT NULL,
  epoch BIGINT NOT NULL,
  ciphertext TEXT,
  nonce TEXT,
  cipher_sha256 TEXT,
  redacted SMALLINT NOT NULL DEFAULT 0 CHECK(redacted IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  PRIMARY KEY (dao_id, content_type, content_id)
);

CREATE INDEX IF NOT EXISTS idx_encrypted_content_dao_epoch
  ON encrypted_content(dao_id, epoch);
