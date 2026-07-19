-- FIN-06a (#1166): serves the household share projection and sync chunk loads
-- (one account's month, date DESC).
CREATE INDEX finance_transactions_account_date_idx ON app.finance_transactions (owner_user_id, account_id, date DESC);
