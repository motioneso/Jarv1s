-- FIN-06a (#1166, F6-D2): finance_items — one row per connected Plaid item.
-- owner_user_id is the mandatory RLS scoping column; platform generates the
-- FORCE RLS policy from module.manifest.database.ownedTables at install time.
CREATE TABLE app.finance_items (
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  institution_id text,
  connected_at text NOT NULL,
  status text NOT NULL,
  last_sync_at text,
  last_error text,
  PRIMARY KEY (owner_user_id, item_id)
);
