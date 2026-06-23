-- Complete the instance_settings DELETE path (#446 web-search key revoke).
--
-- 0059 created an `instance_settings_delete` RLS policy (FOR DELETE TO jarvis_app_runtime,
-- USING app.current_actor_is_admin()), but the table-level GRANT in 0004 only covered
-- SELECT, INSERT, UPDATE — so DELETE was unreachable (`permission denied for table
-- instance_settings`, 42501) even for admins. The encrypted Brave Search key revoke
-- (DELETE /api/admin/settings/web-search) needs it. Widening the grant simply activates the
-- admin-gated policy 0059 already declared; RLS still gates the row, not this grant.
--
-- Reconciliation with 0059's "non-secret config only" note: the web-search key is stored as an
-- AES-256-GCM envelope (ciphertext) produced by the shared credential cipher — never plaintext.
-- The at-rest secret material lives in the credential store's encryption, persisted here as
-- opaque ciphertext; the confidentiality guarantee is unchanged.

GRANT DELETE ON app.instance_settings TO jarvis_app_runtime;
