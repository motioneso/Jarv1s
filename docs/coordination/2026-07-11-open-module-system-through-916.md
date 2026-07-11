# Open Module System — platform state through #916

**What this is:** a plain-language summary of the Open Module System platform built over the
`2026-07-09-job-search-overnight` run — what has shipped, what is still in flight, and what the
completed platform lets a module author do going forward. Grounded on `origin/main` at `ff2ab3a7`
(2026-07-11).

**Parent epic:** #818 — _open module system: user-authored modules (SDK + vault auth + approval
gate)_. The seams below are its slices, plus the two capability layers (#915, #916) that finish the
authoring surface.

---

## The one-paragraph version

The Open Module System turns a Jarvis "module" from something baked into the core image into a
**self-contained, user-authored bundle** the host loads, isolates, and governs at runtime. A module
declares itself in a manifest; the host loads it **fail-closed** behind a versioned contract, gives
it its **own tables + migrations**, a **runtime UI surface**, **encrypted credential + KV storage**,
a **backend worker runtime**, the ability to **queue/schedule background jobs** and make
**SSRF-safe outbound calls**, and a **host action to open the assistant with a pre-filled editable
prompt**. Every one of those seams keeps the hard invariants: RLS applies to all actors (no
admin/worker bypass), secrets never escape, job payloads stay metadata-only, and modules touch each
other only through declared APIs. Once #915 and #916 land, that authoring surface is complete and
the first real consumer — the Intelligent Job Search module (#913) — can be built on it.

---

## Shipped (merged to `main`)

| Seam | Issue | PR / commit | Tier | What it delivers |
| ---- | ----- | ----------- | ---- | ---------------- |
| Slice 1 — manifest loader | #917 | PR #924 / `4bc53694` | — | External manifest loader with **fail-closed activation**: a frozen contract-v1 runtime, version gate _before_ fetch, malformed-export gate, and a Missing fallback. A module that doesn't match the contract simply doesn't load — it can't half-activate. |
| Data plane | #914 | PR #941 / `dff032b9` | security | Per-module **migration ledger**, **privileged install** path, module-**owned tables**, and a **data lifecycle** (export/delete participation). This is how a module gets its own schema without touching core migrations or another module's tables. |
| Slice 2 — runtime UI + storage | #918 | PR #925 / `eafa22dd` | — | Runtime **web/settings UI** surface for modules, plus **module credentials** (encrypted at rest) and a per-module **KV store**. A module can render into the shell and persist its own config/secrets. |
| Slice 3 — worker runtime | #919 | PR #939 / `ff2ab3a7` | security | Backend **worker runtime** for modules + **external assistant tool execution**. Introduces the `jarvis_worker_runtime` actor context — a module's background work runs as a least-privileged actor under RLS, never as an admin. |

All four cleared their gates; the two security-tier seams (#914, #919) got adversarial QA +
sign-off before merge (#919: Opus QA GREEN + Fable; #914: Fable).

---

## In flight

| Seam | Issue | Status | What it adds |
| ---- | ----- | ------ | ------------ |
| Worker capabilities | #915 | **Building** (security tier) | pg-boss **queue / schedule / run-now** registration + reconciliation, and **host-pinned, SSRF-safe outbound fetch**. Lets a module schedule recurring background work and safely call the outside world. Migration 0158 uses the `jarvis_migration_owner` SECURITY DEFINER precedent (worker-only EXECUTE, role-scoped SELECT, pinned `search_path`). _Note: the structured-AI RPC seam originally bundled in this issue's title already shipped separately (#923); this lane is queue/schedule + fetch only._ |
| Host action — open assistant | #916 | **Spec-ready** (signed off, queued behind #915) | `ExternalModuleHostActionsV1.openAssistant({ starterPrompt })` — a module can, **from a user gesture**, open the assistant drawer pre-seeded with an **editable draft** prompt. Host validates + caps the prompt, never auto-submits, and binds the module id host-side so one module can't impersonate another. Fails closed if the module is disabled or its hash drifted. |

**#916 spec sign-off (2026-07-11):** Fable panel — APPROVE WITH EDITS, build-ready vs `ff2ab3a7`.
Two build-guidance edits fold into its handoff when spawned: (1) inject host actions
**per-contribution at load time** (loader / Root props), never onto the shared frozen
`__JARVIS_MODULE_RUNTIME__` global — that's what makes the module-id host-binding implementable;
(2) implement via the never-auto-sent **`initialText` draft path** (#368 pattern), _not_
`openChatWith`, which auto-submits.

---

## What it changes going forward

Once #915 and #916 merge, a module author has a **complete capability surface** without any core
image changes. A user-authored module can:

1. **Declare + load** — ship a manifest; the host loads it fail-closed behind a versioned contract (#917).
2. **Own its data** — get its own tables + migrations via privileged install + per-module ledger, and participate in export/delete (#914).
3. **Render + persist** — surface UI in web/settings, store encrypted credentials, and use a KV store (#918).
4. **Run backend work** — execute in a least-privileged worker runtime and call external assistant tools (#919).
5. **Schedule + reach out** — register queue/schedule/run-now jobs with reconciliation, and make SSRF-safe host-pinned fetches (#915).
6. **Drive the assistant** — open the chat drawer with a pre-filled, editable, user-confirmed prompt (#916).

**Invariants preserved across all six** (these are the platform's guarantees to the user, not
conveniences): RLS applies to every actor including workers and admins (no `BYPASSRLS`); secrets are
AES-256-GCM at rest and never reach frontend/logs/payloads/prompts; pg-boss payloads are
metadata-only; modules collaborate only through declared APIs; host actions are module-id-bound and
fail closed on disable/hash-drift.

### The first consumer is unblocked

With the surface complete, the **Intelligent Job Search module** (epic #913) can be built entirely
on top of it — no further platform work required. Its nine tasks **JS-01…JS-09 (#930–#938)** already
have design specs on `main` (landed via PR #929). Two caveats:

- Those specs are **merged-as-draft, not yet drift-signed-off** — their `needs-spec` labels stay on
  until each gets its own sign-off pass (the same drift check #916 just passed).
- Each JS task still needs its **coordinated-build plan approval** before code — the standing
  spec-before-build process gate is per-task, not waived by the platform being done.

---

## Remaining gates before the Job Search module starts

1. **#915** — wrap-up PR → security-tier Opus adversarial QA + overnight two-model panel sign-off → merge.
2. **#916** — spawn build lane after #915 lands; security-adjacent (host trust boundary) → same QA bar; fold in Fable's two edits.
3. Then **JS-01…JS-09** build on the finished platform, each through its own plan-approval gate.

_Coordinator: `2026-07-09-job-search-overnight` run manifest holds live fleet/merge-order state._
