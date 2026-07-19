-- FIN-06a (#1166, F6-D2): finance_balance_snapshots. PK enforces the
-- (owner, account, day) uniqueness the KV SnapshotChunk model already relied on.
CREATE TABLE app.finance_balance_snapshots (
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  day date NOT NULL,
  balance_cents bigint NOT NULL,
  PRIMARY KEY (owner_user_id, account_id, day)
);
