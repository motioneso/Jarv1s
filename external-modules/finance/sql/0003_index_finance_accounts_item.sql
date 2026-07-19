-- FIN-06a (#1166): serves the item-status lookup (accounts by owner+item).
CREATE INDEX finance_accounts_item_idx ON app.finance_accounts (owner_user_id, item_id);
