-- FIN-06a (#1166): serves feed/budget/reports month-window reads across all
-- of an owner's accounts (date DESC).
CREATE INDEX finance_transactions_date_idx ON app.finance_transactions (owner_user_id, date DESC);
