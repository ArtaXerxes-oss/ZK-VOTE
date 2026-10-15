-- Double-Entry Financial Ledger (Issue #796)
-- Implements chart of accounts, journal entries, and reconciliation

-- Chart of Accounts
CREATE TABLE IF NOT EXISTS ledger_accounts (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  account_type VARCHAR(50) NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  parent_id INTEGER REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Operational accounts for ZK-VOTE
INSERT INTO ledger_accounts (code, name, account_type) VALUES
  ('1000', 'Relayer Float', 'asset'),
  ('1100', 'DAO Treasuries', 'asset'),
  ('1200', 'Escrows', 'asset'),
  ('2000', 'Fees Payable', 'liability'),
  ('3000', 'Equity', 'equity'),
  ('4000', 'Fee Revenue', 'revenue'),
  ('5000', 'Transaction Fees', 'expense'),
  ('5100', 'Dust Account', 'expense'),
  ('5200', 'Rounding Adjustments', 'expense');

-- Journal Entries (double-entry postings)
CREATE TABLE IF NOT EXISTS ledger_entries (
  id BIGSERIAL PRIMARY KEY,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  description VARCHAR(500) NOT NULL,
  reference_type VARCHAR(50), -- 'payment', 'swap', 'anchor_deposit', 'anchor_withdraw', 'reward'
  reference_id VARCHAR(255), -- External ID (payment hash, swap ID, etc.)
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(255),
  is_reconciled BOOLEAN NOT NULL DEFAULT false,
  reconciled_at TIMESTAMP WITH TIME ZONE
);

-- Journal Entry Lines (debits and credits)
CREATE TABLE IF NOT EXISTS ledger_lines (
  id BIGSERIAL PRIMARY KEY,
  entry_id BIGINT NOT NULL REFERENCES ledger_entries(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
  debit_stroops BIGINT NOT NULL DEFAULT 0 CHECK (debit_stroops >= 0),
  credit_stroops BIGINT NOT NULL DEFAULT 0 CHECK (credit_stroops >= 0),
  asset_code VARCHAR(12) NOT NULL DEFAULT 'XLM',
  asset_issuer VARCHAR(56),
  memo VARCHAR(500),
  CHECK ((debit_stroops > 0 AND credit_stroops = 0) OR (debit_stroops = 0 AND credit_stroops > 0))
);

-- Daily Balance Proof (period close)
CREATE TABLE IF NOT EXISTS ledger_daily_close (
  close_date DATE PRIMARY KEY,
  total_debits BIGINT NOT NULL,
  total_credits BIGINT NOT NULL,
  balance_proof_hash VARCHAR(64) NOT NULL,
  is_balanced BOOLEAN NOT NULL,
  discrepancy_stroops BIGINT NOT NULL DEFAULT 0,
  closed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_by VARCHAR(255)
);

-- Reconciliation Table (chain vs books)
CREATE TABLE IF NOT EXISTS ledger_reconciliations (
  id BIGSERIAL PRIMARY KEY,
  reconciliation_date DATE NOT NULL,
  account_id INTEGER NOT NULL REFERENCES ledger_accounts(id),
  ledger_balance_stroops BIGINT NOT NULL,
  chain_balance_stroops BIGINT,
  discrepancy_stroops BIGINT,
  status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'matched', 'discrepancy', 'resolved')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by VARCHAR(255)
);

-- Indexes for performance
CREATE INDEX idx_ledger_entries_date ON ledger_entries(entry_date);
CREATE INDEX idx_ledger_entries_reference ON ledger_entries(reference_type, reference_id);
CREATE INDEX idx_ledger_lines_entry ON ledger_lines(entry_id);
CREATE INDEX idx_ledger_lines_account ON ledger_lines(account_id);
CREATE INDEX idx_ledger_reconciliations_date ON ledger_reconciliations(reconciliation_date);
CREATE INDEX idx_ledger_reconciliations_status ON ledger_reconciliations(status);

-- View: Account Balances
CREATE OR REPLACE VIEW ledger_account_balances AS
SELECT 
  a.id AS account_id,
  a.code,
  a.name,
  a.account_type,
  SUM(l.debit_stroops) AS total_debits,
  SUM(l.credit_stroops) AS total_credits,
  CASE 
    WHEN a.account_type IN ('asset', 'expense') THEN SUM(l.debit_stroops - l.credit_stroops)
    ELSE SUM(l.credit_stroops - l.debit_stroops)
  END AS balance_stroops,
  l.asset_code
FROM ledger_accounts a
LEFT JOIN ledger_lines l ON a.id = l.account_id
GROUP BY a.id, a.code, a.name, a.account_type, l.asset_code;

-- View: Daily Trial Balance (verifies books balance)
CREATE OR REPLACE VIEW ledger_trial_balance AS
SELECT 
  entry_date,
  SUM(debit_stroops) AS total_debits,
  SUM(credit_stroops) AS total_credits,
  SUM(debit_stroops) - SUM(credit_stroops) AS balance
FROM ledger_entries e
JOIN ledger_lines l ON e.id = l.entry_id
GROUP BY entry_date
ORDER BY entry_date DESC;

-- Function: Check if entry is balanced
CREATE OR REPLACE FUNCTION check_entry_balanced()
RETURNS TRIGGER AS $$
DECLARE
  entry_debits BIGINT;
  entry_credits BIGINT;
BEGIN
  SELECT SUM(debit_stroops), SUM(credit_stroops)
  INTO entry_debits, entry_credits
  FROM ledger_lines
  WHERE entry_id = NEW.entry_id;

  IF entry_debits != entry_credits THEN
    RAISE EXCEPTION 'Journal entry % is unbalanced: debits=% credits=%', 
      NEW.entry_id, entry_debits, entry_credits;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ensure_balanced_entry
AFTER INSERT OR UPDATE ON ledger_lines
FOR EACH ROW
EXECUTE FUNCTION check_entry_balanced();

COMMENT ON TABLE ledger_accounts IS 'Chart of accounts for double-entry bookkeeping';
COMMENT ON TABLE ledger_entries IS 'Journal entries (transaction headers)';
COMMENT ON TABLE ledger_lines IS 'Journal entry lines (debits and credits)';
COMMENT ON TABLE ledger_daily_close IS 'Daily period close with balance proof';
COMMENT ON TABLE ledger_reconciliations IS 'Chain-vs-books reconciliation tracking';
