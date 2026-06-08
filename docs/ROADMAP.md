# Jarv1s Roadmap

Scope-boxed milestones — each exits when tested and all hard invariants hold. No calendar
deadlines. See the GitHub Project board for live status and the GitHub Milestones for associated
issues.

## Track A — Daily Driver

The throughline: make the dormant memory/vault/structured-state substrate real and grounded in my
actual notes, then turn it into focusing briefings and a wellness loop.

| Milestone                                         | Goal                                                                                                | Exit condition                                            | Status       |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------ |
| **M-A1** · Real embeddings + live vault ingestion | Swap StubEmbeddingProvider for a real LocalEmbeddingProvider; ingest real Obsidian vault            | Semantic search over notes returns real hits              | **Complete** |
| **M-A2** · Surface the substrate (REST + UI)      | REST APIs + web shell views for structured-state and vault search                                   | I can see my commitments and search my notes in the UI    | Not started  |
| **M-A3** · Real AI provider calls                 | Capability router actually calls a configured provider (Claude, BYO)                                | Chat returns real responses; no provider hardcoded        | Not started  |
| **M-A4** · Vault-grounded daily briefings         | Wire MemoryRetriever + commitments + real AI into Briefings; activate recurring schedule            | Daily briefing runs automatically and is genuinely useful | Not started  |
| **M-A5** · Commitments ↔ tasks loop               | Connect structured-state commitments to Tasks surface; optional: confirmation-gated write execution | Open commitments surface as tasks; drift is visible       | Not started  |
| **M-A6** · Wellness module                        | New built-in module for mental + physical wellbeing (manual entry + trends)                         | Manual check-ins recorded; trend view working             | Not started  |

## Track B — Shippable Product

After Track A proves the daily driver, these milestones move toward a product others can self-host.

| Milestone                                 | Goal                                                               | Exit condition                                        | Status      |
| ----------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------- | ----------- |
| **M-B1** · Real connectors (OAuth + sync) | Live Google/Microsoft OAuth + calendar/email sync into read caches | Real calendar/email data visible; tokens never leak   | Not started |
| **M-B2** · Multi-user & onboarding polish | First-run onboarding, sharing UI, visual design pass               | A new self-hoster can get up and running without help | Not started |
| **M-B3** · Release engineering            | Versioning, changelog, upgrade story, deployment docs              | pnpm smoke:compose passes on a clean checkout         | Not started |

## Development Lifecycle (per milestone)

1. **Frame** — GitHub Milestone + epic issue with exit criteria
2. **Spec** — design spec in `docs/superpowers/specs/` (required before any build)
3. **Plan** — implementation plan; decompose into task issues
4. **Build** — thin slices, one focused task at a time
5. **Verify** — `pnpm verify:foundation` + focused suite; `pnpm audit:release-hardening` stays green
6. **Record** — ADR for non-obvious decisions; agentmemory for durable lessons; close issues; update this doc

## Hard invariants (never weaken these)

- `FORCE ROW LEVEL SECURITY` on all product tables; no admin private-data bypass
- Repositories accept only `DataContextDb`, never root Kysely
- All vault I/O through `VaultContext`, never raw `fs` calls
- `AccessContext` carries only `actorUserId` and `requestId` — no workspace or other additions
- Secrets never reach frontend, logs, job payloads, or AI prompts
- pg-boss payloads are metadata-only (actor/resource IDs, job kind, idempotency key)
- Provider-agnostic AI — no feature hardcodes a provider/model
- Every new module follows the full SDK contract (`@jarv1s/module-sdk`)
- Spec before build — no code without an approved spec
