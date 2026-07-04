-- #729 §5: email-derived staged tasks need the smallest explicit review state. A `suggested`
-- task is created by the email task engine (mode `suggest`) and only becomes real work when the
-- user accepts it (PATCH → `todo`); it never sets completed_at and the completion cascade
-- ignores it. Safe inside the migration transaction: the new value is not used in this file.
ALTER TYPE app.task_status ADD VALUE IF NOT EXISTS 'suggested';
