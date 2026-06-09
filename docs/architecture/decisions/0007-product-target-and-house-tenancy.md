# 0007 — Product target: personal daily-driver, built for the "house" (self-hosted multi-user)

**Status:** accepted (2026-06-09)
**Context:** Foundation-alignment grill (2026-06-09), after the M-A5 / M-B1 merge night and a
five-dimension project audit. The hard lesson from the first iteration of Jarv1s: it was built
_only for Ben_, which worked well short-term but proved unsustainable — personal coupling was
nearly impossible to strip out later. This ADR fixes the target up front so we do not repeat that.

## Decision

1. **Two goals, one architecture.** The primary goal is Ben's rock-solid **personal daily-driver**;
   but from day one we **architect for others too**. Both, not one.

2. **The "house" model.** A user **self-hosts a single instance on their own machine** and can host
   friends/family on it — **multi-user per instance**, each with their own account (e.g. Ben +
   Katherine). This is _not_ one shared SaaS that Ben hosts for the world.

3. **Never depends on Ben's server.** Build as if the code _could never see Ben's machine again_:
   no host/machine-specific coupling baked into the product. **Portability is a foundation
   invariant**, not a later milestone. (Ben's own Outlook connector is a personal **sidecar**,
   deliberately kept _out_ of the shipped product — see Backlog.)

4. **Shared subscription by default; API key is the opt-out.** On an instance the AI is powered by
   the host's **shared CLI subscription** across household accounts; a user who wants their own LLM
   uses **API keys** instead. (The "own subscription but shares someone else's instance" case is
   deferred.) See ADR 0008.

5. **Multi-user is near-term, not "someday."** Katherine is the first secondary user. Per-user RLS,
   account management (admin-invite), and onboarding are **foundation** work — the auth-secret RLS
   gap moves to Phase 1.

6. **Clients:** **web / PWA-first**; mobile is the user's own port-forward + installed PWA; no native
   mobile app in the near term.

7. **Not commercial.** **Maintainability**, not monetization, is the driver — no billing or
   commercial-tenancy design. "Build it right the first time" over speed.

## Consequences

- The host-bound chat engine must become portable → **ADR 0008**.
- **Onboarding / setup becomes first-class** (admin-invite accounts; hybrid Jarvis-guided + skippable
  walkthrough) — Phases 2 (primary) and 4 (secondary).
- Multi-user hardening (auth-secret RLS, rate-limiting) is pulled forward to Phase 1.
- We accept that the operator carries some self-host operational burden (supervision, backups) — so
  those must be made **safe and as automatic as possible** (Phase 1/2), not assumed.
