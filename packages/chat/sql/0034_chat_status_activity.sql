-- Extend chat_message_status enum with async execution statuses.
-- 'working' = provider call is in progress
-- 'error'   = provider call failed; body contains the error summary

ALTER TYPE app.chat_message_status ADD VALUE IF NOT EXISTS 'working';
ALTER TYPE app.chat_message_status ADD VALUE IF NOT EXISTS 'error';
