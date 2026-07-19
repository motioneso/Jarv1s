-- FIN-06a (#1166, F6-D2): finance_transactions. PK (owner_user_id, id) is the
-- idempotency key that replaces per-chunk KV dedup. account_id is a plain
-- (soft) reference — no FK to finance_accounts, matching the KV model where
-- a transaction can outlive its account row during sync.
CREATE TABLE app.finance_transactions (
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  id text NOT NULL,
  account_id text NOT NULL,
  date date NOT NULL,
  amount_cents bigint NOT NULL,
  iso_currency text NOT NULL,
  name text NOT NULL,
  merchant text,
  plaid_category text,
  category_id text,
  pending boolean NOT NULL,
  pending_transaction_id text,
  categorized_by text,
  notes text,
  PRIMARY KEY (owner_user_id, id)
);
