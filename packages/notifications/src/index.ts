// Notifications V1 — in-app, actor-scoped delivery: a notification is a personal message
// whose `recipient_user_id` is always `app.current_actor_user_id()`, created inside that
// actor's `DataContextRunner` scope. It is NOT a cross-user / system-broadcast mechanism
// and V1 ships no external push / email / SMS delivery. See the manifest docblock for the
// full model and the spec (docs/superpowers/specs/2026-06-19-notifications-actor-scoped-hardening.md).
export * from "./manifest.js";
export * from "./metadata.js";
export * from "./digest.js";
export * from "./repository.js";
export * from "./routes.js";
