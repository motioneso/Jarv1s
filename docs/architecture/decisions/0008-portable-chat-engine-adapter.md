# 0008 — The chat engine is a pluggable adapter behind the capability router (portable)

**Status:** accepted (2026-06-09). **Evolves** ADR 0003 (_interactive chat is CLI transport_).
**Context:** Live chat currently drives the `claude` / `codex` / `gemini` **CLI binaries in a tmux
session on the host**, using the operator's personal login — welded to one machine (the v1 trap; the
2026-06-09 audit flagged it as the single biggest "prototype vs product" gap). ADR 0007 requires
portability ("never depends on Ben's server"). M-A3 already shipped a **provider-agnostic capability
router with real HTTP provider adapters** (API-key path), but the chat drawer doesn't use it — it
only knows the CLI engine.

## Decision

1. **The chat engine becomes a pluggable adapter behind the capability router.** Two adapter
   families: (a) a **terminal-CLI adapter** that drives `claude`/`codex`/`gemini` through a
   multiplexer (**tmux or herdr**) using the user's own subscription auth; (b) an **API-key adapter**
   (the existing HTTP provider adapters). No engine is hard-coded; the router selects the configured
   adapter. Features target the **adapter/router interface, never the CLI directly**.

2. **Portability via onboarding-provisioning, not image-baking.** We do **not** containerize or
   bundle the CLI binaries. The deploy/onboarding flow **installs prerequisites** (the multiplexer)
   on the target host and **guides the user to authenticate their own CLI**. Because **each
   user/instance auths their own subscription**, the ToS concern (using Ben's subscription to serve
   others) dissolves.

3. **Per-instance choice at onboarding.** A household admin picks the path(s): CLI-subscription, API
   keys, or both. **Default = shared CLI subscription; API keys = opt-out** (ADR 0007 §4).

4. **In-process and self-hosted.** This is not a cloud/multi-tenant inference service; it is a
   per-instance engine the household runs themselves.

## Consequences

- ADR 0003's "CLI is _the_ transport" narrows to **"CLI is _one_ adapter."**
- New chat/AI features must go through the capability router, so we never re-couple to a single host
  engine.
- **Onboarding owns prerequisite provisioning** (multiplexer install, CLI auth, or API-key entry).
- Unblocks self-hosting by anyone (Phase 2), which is the gate for friends/family testing.
