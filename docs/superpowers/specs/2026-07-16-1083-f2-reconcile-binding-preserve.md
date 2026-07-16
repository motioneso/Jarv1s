# Spec — #1083-F2: reconcile dangles admin model bindings

Lane C2. Status: APPROVED (Fable, delegated auth 2026-07-16). Build = `gpt-5.6-sol`, QA = Opus.
(C1 / F1 shell-tool posture is a separate mechanical PR, no spec — already in flight.)

## Decision (locked) — pragmatic two-part, no schema migration now

Chosen over the full natural-key + FK re-architecture. The FK migration touches the `ai.service_bindings` blob + needs a data migration of existing bindings; that's a re-architecture, out of scope for a security-sweep cleanup. Instead:

1. **Diff-and-preserve stable model-row ids.** Reconcile must NOT hard-delete + re-insert CLI concrete model rows with fresh UUIDs when the discovered set is unchanged. Compare the discovered set against existing rows by **natural key** (provider + provider_model_id) and preserve the existing row id when the model is unchanged; only insert genuinely-new models and delete genuinely-removed ones. This kills the reported reconnect-dangles bug (the common case: unchanged set on every connect event).
2. **Resilient fall-through in `resolveModelForService`.** As a safety net for the residual case (a real model add/remove that legitimately changes ids), when a service binding's `modelId` no longer resolves, **fall through to the provider default** instead of returning hard `needs-config`. A dangled binding degrades gracefully rather than breaking News/economy JSON calls.

Follow-up (file separately, do NOT build now): natural-key + FK on `ai.service_bindings` to structurally eliminate the dangle class — flag for Ben under the #869/#860 area.

## Files

- `packages/ai/src/discover-and-persist-models.ts` (line ~39, the `deleteModelsForProviderExceptSentinel` call site) + `packages/ai/src/repository.ts` (`deleteModelsForProviderExceptSentinel` :584, and the insert path) — implement diff-and-preserve by natural key.
- `packages/ai/src/auto-register.ts` — the login-ready reconcile (`ensureDefaultChatModel`) must go through the diff path, not unconditional delete+insert.
- `packages/ai/src/repository.ts` (`resolveModelForService` :1168) + `packages/ai/src/structured/generate-structured.ts` (:72 call site) — add the provider-default fall-through when a bound `modelId` is unresolved.

## Tests

- Integration: bind `module.news` → simulate a connect-shaped reconcile with an **unchanged** discovered set → the bound `modelId` still resolves (row id preserved), no needs-config. This is the exact #1083 scenario (bind → token expiry → re-login → reconcile).
- Integration: reconcile with a genuinely-changed set that removes the bound model → `resolveModelForService` falls through to provider default (not hard needs-config).

## Exit criterion

Both integration tests green; the bind survives a reconnect reconcile. Green `verify:foundation`. Opus sign-off. No migration in this PR (if the build discovers one is unavoidable, stop and escalate — the decision was explicitly no-migration).
