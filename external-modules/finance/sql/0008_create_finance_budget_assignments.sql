-- FIN-06a (#1166, F6-D2): finance_budget_assignments. PK enforces the
-- (owner, month, category) uniqueness that made KV setAssignment a
-- replay-safe SET-the-total operation (FIN-03 contract, carried forward).
CREATE TABLE app.finance_budget_assignments (
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  month text NOT NULL,
  category_id text NOT NULL,
  assigned_cents bigint NOT NULL,
  PRIMARY KEY (owner_user_id, month, category_id)
);
