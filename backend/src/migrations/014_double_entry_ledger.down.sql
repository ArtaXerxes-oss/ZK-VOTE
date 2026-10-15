-- Rollback double-entry ledger

DROP TRIGGER IF EXISTS ensure_balanced_entry ON ledger_lines;
DROP FUNCTION IF EXISTS check_entry_balanced();
DROP VIEW IF EXISTS ledger_trial_balance;
DROP VIEW IF EXISTS ledger_account_balances;
DROP TABLE IF EXISTS ledger_reconciliations;
DROP TABLE IF EXISTS ledger_daily_close;
DROP TABLE IF EXISTS ledger_lines;
DROP TABLE IF EXISTS ledger_entries;
DROP TABLE IF EXISTS ledger_accounts;
