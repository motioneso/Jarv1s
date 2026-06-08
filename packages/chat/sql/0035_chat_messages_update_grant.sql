-- Grant UPDATE on chat_messages to the app runtime role so the pg-boss worker
-- can transition assistant messages through: pending → working → stored | error.
-- The accompanying RLS policy restricts updates to the owner's own messages only.

GRANT UPDATE ON app.chat_messages TO jarvis_app_runtime;

DROP POLICY IF EXISTS chat_messages_update ON app.chat_messages;
CREATE POLICY chat_messages_update
ON app.chat_messages
FOR UPDATE
TO jarvis_app_runtime
USING (owner_user_id = app.current_actor_user_id())
WITH CHECK (owner_user_id = app.current_actor_user_id());
