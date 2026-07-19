-- FIN-06a (#1166): finance_accounts. shared_to_household defaults false —
-- "absent means private" per FIN-04; a row is only visible to the household
-- feed once explicitly flipped.
CREATE TABLE app.finance_accounts (
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  item_id text NOT NULL,
  name text NOT NULL,
  official_name text,
  type text NOT NULL,
  subtype text,
  mask text,
  balance_cents bigint NOT NULL,
  iso_currency text NOT NULL,
  updated_at text NOT NULL,
  shared_to_household boolean NOT NULL DEFAULT false,
  PRIMARY KEY (owner_user_id, account_id)
);
