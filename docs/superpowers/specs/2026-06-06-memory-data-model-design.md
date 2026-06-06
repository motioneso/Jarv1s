# Memory & Data Model — Foundation Design

Status: Draft (awaiting review)
Date: 2026-06-06
Owner: Ben

## Context

Jarv1s is a single-user-first (household-capable) AI personal assistant — a "personal
chief of staff" whose core value is long-term memory, retrieval, reasoning over the user's
life, and curating their information world. The current repository is an early scaffold whose
engineering investment went mostly into a multi-tenant security/module substrate; the memory
layer that the product actually lives on has no architecture yet. This spec defines that
memory & data model so it is designed first, not bolted on.

This is the **keystone** foundation: BYOP (the AI provider/capability router), the proactivity
engine, and content curation all read from and write to the model defined here. They are
explicitly out of scope for this spec and come later.

### Product framing that shaped these decisions

- Default persona is one person; the real near-term case is two people (spouses) on one instance
  who each keep genuinely private data. **Per-user privacy is first-class, not retrofitted.**
- Strong **anti-lock-in / "file over app"** stance: durable knowledge lives in the user's own
  tool (Obsidian today, Notion later) as portable files. If the user leaves Jarvis, they keep
  their folder of notes and lose nothing.
- Strong **data-sovereignty / privacy** stance: the user decides who processes their data;
  prefer keeping sensitive processing local.
- Emphasis on **executive-function support (ADHD)**: reliably tracking open loops and surfacing
  the right thing at the right time matters more than raw feature count.

## Goals

1. Define where memory lives, who can see it, and how the agent reads/writes it.
2. Make per-user data isolation enforceable for both database rows **and** vault files.
3. Keep the user un-locked-in: knowledge stays portable; AI/embedding backends are pluggable.
4. Make retrieval useful today without depending on BYOP.
5. Establish clean, stable seams so future features connect to memory additively.

## Non-Goals (deferred to later specs)

- BYOP / capability router / chat / real model reasoning.
- Proactivity engine and scheduler.
- Connector → memory ingestion (email/calendar/etc. feeding the index).
- Notion (and other) knowledge backends — interface only; Obsidian/filesystem is the first impl.
- Per-user encryption at rest — design the seam only.
- Curation / feeds / sports / briefing content.

## Resolved Decisions

| #   | Decision        | Choice                                                              | Why                                                                                       |
| --- | --------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | Design target   | Memory & data model first                                           | Keystone; everything else depends on its contract.                                        |
| 2   | Memory home     | **Split**: knowledge = files, structured state = DB                 | Open loops/deadlines must be reliably queryable; prose belongs in portable files.         |
| 3   | File access     | **Jarvis hosts the canonical vault** (optional import)              | Jarvis can only secure what it controls; enables per-user isolation.                      |
| 4   | Vault security  | **App-layer isolation now, encryption-ready**                       | Mirrors RLS; keeps files plain markdown for portability; clean seam for later encryption. |
| 5   | Retrieval       | **Universal internal index; vault is a source, not the index**      | Memory layer must exist with or without a vault, and grow over time.                      |
| 6   | Embeddings      | **Local, pluggable**                                                | Privacy-first (notes never leave the box); decouples retrieval from BYOP.                 |
| 7   | Write-back      | **Frontmatter machine-owned, body human-owned**                     | Jarvis keeps structured fields current without ever clobbering the user's prose.          |
| 8   | Roles vs access | **Orthogonal**: roles = platform abilities; access = owner-or-share | Preserves "no admin private-data bypass."                                                 |

## Architecture Overview

Four data surfaces, each with one owner and an explicit canonical/derived rule:

| Surface                                                                             | Store                              | Canonical?              | Accessed via    |
| ----------------------------------------------------------------------------------- | ---------------------------------- | ----------------------- | --------------- |
| **Vault** — knowledge: notes, daily logs, people notes                              | Files, per-user Jarvis-hosted root | ✅ canonical & portable | `VaultContext`  |
| **Memory index** — chunks + local embeddings (pgvector) + wikilink graph + metadata | Postgres                           | ❌ derived, rebuildable | `DataContextDb` |
| **Structured agent state** — preferences, commitments, entities                     | Postgres                           | ✅ canonical            | `DataContextDb` |
| **Operational** — jobs, schedules, audit, shares, roles                             | Postgres                           | ✅ canonical            | `DataContextDb` |

Two pluggable interfaces preserve anti-lock-in:

- **`KnowledgeBackend`** — Obsidian/filesystem first; Notion etc. later. The vault is optional;
  the memory layer functions without one.
- **`EmbeddingProvider`** — a local on-box model first; a BYO cloud embeddings model later
  (through the future capability router), selectable per user.

Two security contexts, both minted from the same `AccessContext` (`{ actorUserId, requestId }`):

- **`DataContextDb`** (exists today) — branded handle; all DB access runs inside a transaction
  with `app.actor_user_id` set; Postgres RLS evaluates owner-or-share.
- **`VaultContext`** (new) — the filesystem twin; branded handle that resolves only paths under
  the actor's vault root, normalized and traversal-checked. The single chokepoint for all vault
  file I/O.

### Core loop

```
vault file change ──▶ watch/scan ──▶ parse (frontmatter, [[links]], headings)
                  ──▶ chunk ──▶ local embed ──▶ upsert index (chunks + graph + provenance)

query ──▶ vector search (+ graph expansion + recency boost)
      ──▶ ranked chunks WITH provenance (path + line range)
      ──▶ full source re-read via VaultContext

Jarvis authors markdown back (people notes, daily logs) via VaultContext ──▶ re-indexed
```

Nothing in this loop depends on BYOP.

## Data Model

### Structured agent state

Three typed, RLS-scoped, shareable record types. (No generic "facts" bucket yet — YAGNI; it
becomes a junk drawer. Add only on demonstrated need.)

Every structured-state record carries two brand-mandated, cross-cutting dimensions:

- **`provenance`** ∈ `volunteered | inferred | confirmed` — was this told to Jarvis, guessed by
  Jarvis, or guessed-then-confirmed by the user. ("Context is volunteered, refined, and reversible";
  "confirmed inferences.")
- **Legible & reversible** — anything Jarvis believes is user-visible and editable; a record can be
  corrected, dismissed, or deleted. No opaque beliefs.

The records:

- **`commitments`** (open loops) — the chief-of-staff primitive.
  `{ id, owner_user_id, title, counterparty?, due_at?, status, provenance, source_kind,
source_ref?, surfaced_state, created_at, updated_at }`.
  `status` is a drift-aware lifecycle: `open → at_risk → slipped → done | renegotiated |
dismissed`. Recovery states are first-class, never error states ("This slipped. We can reset
  it."). Distinct from a Task: a Task is something the user chose to track; a commitment is
  something Jarvis noticed the user is on the hook for and may later promote to a Task. Powers
  "what's due in 3 days" and proactive nudges.
- **`entities`** — people / orgs / accounts.
  `{ id, owner_user_id, type, name, attributes (jsonb, typed per type), provenance,
vault_note_path?, connector_refs?, created_at, updated_at }`.
  A person links to its People-note file **and** to e.g. a shared Plaid connection.
- **`preferences`** — typed agent/user settings, including **persona config** (assistant name,
  tone, humor, directness, recovery mode, accountability style) per the brand's configurable
  personality. Adaptation must be legible and reversible. Most-restrictive-wins where an admin
  policy applies.

**`life_area`** (work / personal / family / health / …, user-definable) is an _optional tag_ on
structured state and indexed knowledge, used only for **briefing and focus filtering** — it is
**not** an access-control boundary. Sharing remains per-resource. Deferred to the structured-state
slice; recorded here so the schema reserves room.

**Scoped autonomy** (the brand's "autonomy is granted, not assumed") is a downstream agent
concern. Not built here, but the model leaves a clean seam: autonomy grants will be their own
record type keyed to capability + scope, never inferred.

### Memory index (derived, rebuildable)

- **`memory_chunks`** — `{ id, owner_user_id, source_kind, source_path, line_start, line_end,
content_hash, text, embedding vector, updated_at }`.
- **`memory_links`** — extracted `[[wikilink]]` graph: `{ owner_user_id, from_path, to_path }`.
- Provenance (path + line range) lets retrieval hand back chunks that are re-readable in full
  via `VaultContext`. Wiping these tables and re-scanning the vault fully reconstructs them.
- Requires the **pgvector** extension (`CREATE EXTENSION vector`) and a pgvector-enabled
  Postgres image.

### Sharing — `shares`

```
shares { id, resource_type, resource_id, owner_user_id, grantee_user_id, level, created_at, updated_at }
level ∈ view | contribute | manage
```

- One generic mechanism for every shareable resource (tasks, commitments, entities, finance
  connections, research, media). "Chores" = shared tasks at `contribute`.
- RLS policies consult `shares` through a single helper `app.has_share(resource_type,
resource_id, level)` — which answers the share half only; policies OR it with
  `owner_user_id = app.current_actor_user_id()` (mirrors `app.has_resource_grant`).
- **Private by default; sharing explicit, per-resource, revocable, audited.**
- Removing workspaces lets `AccessContext` drop `workspace_id` → context becomes
  `{ actorUserId, requestId }`; RLS becomes "owner OR qualifying share."

### Roles (platform abilities — orthogonal to data access)

- Two roles to start, with ability inheritance: **instance-admin → user**. Extensible later.
- Abilities only: manage the instance, enable/disable global modules, maintenance, add/remove/
  assist users. **Roles grant no data visibility.** Admin inherits every user _ability_, never
  any user's _data_.
- First-user bootstrap (already present) marks the first user instance-admin. `admin_audit_events`
  is retained.

## Vault Subsystem

- **Per-user root**: `/data/vaults/<user_id>/`, OS perms `0700`, owned by the Jarvis service
  account. Stops other host login users from browsing.
- **Optional import**: onboarding can relocate an existing vault into the Jarvis-hosted root,
  after which it is canonical and the user syncs it to their devices with a tool of their choice
  (Syncthing, git, Obsidian pointed at the synced copy). Using Jarvis without a vault is fully
  supported.
- **`VaultContext`** is the only way to touch vault files: `VaultContextRunner.withVaultContext(
accessContext, work)` resolves the root, every op takes a relative path, normalized +
  traversal-checked to stay under root. No raw `fs` access elsewhere.
- **Encryption-ready**: because `VaultContext` is the single chokepoint, per-user encryption at
  rest can be inserted later without changing any caller.
- **Agent boundary**: the agent always operates inside a specific user's `DataContextDb` +
  `VaultContext`. It cannot exceed that user's boundary. Vault content is treated as **data, not
  authority** (the prompt-injection seam, ready for when the model lands).

## Write-Back Model

- Jarvis authors and maintains markdown in the vault (e.g. `People/`, daily logs, decision
  records).
- **Frontmatter (YAML) is machine-owned** — structured fields, kept in sync with the
  corresponding DB record (e.g. an `entities` row). **The body is human-owned** — Jarvis never
  overwrites the user's prose; it may append clearly-marked managed sections only.
- This makes a "person" simultaneously a queryable DB record and a portable Obsidian note,
  round-tripping without conflict.

## Changes to the Existing Scaffold

These are one-time foundation corrections that establish the clean seams future features connect
to. After this, development is additive.

- **Delete** `packages/notes` and `app.notes` (+ migration, routes, web UI, tests). Knowledge
  belongs in the vault, not DB rows.
- **Replace** the _data-access_ machinery — `app.workspaces`, memberships, and the workspace/
  grant hierarchy — with `shares`. Simplify `AccessContext` (drop `workspace_id`). Migrate Tasks'
  `workspace` visibility to the shares model. (This is distinct from platform roles below, which
  are retained.)
- **Retain** the instance-admin role, its admin→user ability inheritance, and first-user
  bootstrap as a _platform-ability_ concept — never a data-access one.
- **Swap** the Postgres image to a pgvector-enabled one and add `CREATE EXTENSION vector`.
- **Keep** everything else intact: `DataContextDb`/RLS substrate, pg-boss (metadata-only
  payloads), module registry, Better Auth, and all hard invariants.

## Testing Strategy

All new development is **TDD** — tests written first; the existing `pnpm verify:foundation`
gate (lint, format, file-size <1000 lines, typecheck, migrate, integration) must stay green.

Integration tests (Vitest against real Postgres + a temp vault root):

- **VaultContext isolation**: user A cannot read/write user B's files; path traversal is blocked.
- **Index**: ingest produces chunks/links/provenance; edit & delete reconcile by hash; full
  rebuild from vault reproduces the index.
- **Structured-state RLS**: private by default; share grants make a resource visible at the
  granted level; revocation removes access.
- **Sharing across resource types**: `has_share` behaves uniformly for tasks/commitments/
  entities.
- **Write-back**: a Jarvis frontmatter update preserves the human-authored body verbatim.
- **No admin bypass — extended to files**: an instance-admin cannot read another user's vault
  _through Jarvis_ (DB no-bypass tests are retained).

## Architectural Principles (standing)

- **File over app**: durable knowledge is portable files the user owns; the DB index is derived
  and rebuildable.
- **BYO everything**: pluggable AI provider, embedding provider, and knowledge backend — no
  feature hardcodes one.
- **Additive features**: a feature is a package that connects to the core platform and DB through
  stable interfaces; it does not modify core files or APIs.
- **Two orthogonal axes**: platform abilities (roles) vs data access (owner-or-share). Never
  conflate them.
- **One chokepoint per boundary**: `DataContextDb` for rows, `VaultContext` for files — so
  isolation (and later encryption) lives in exactly one place.
- **The agent sees all of its user's stored data**: there is no intra-user "hide this from
  Jarvis" gating. Privacy _from_ the agent means not storing it in Jarvis (e.g. a separate vault
  you don't import). The access boundary is the user, not a context within the user.
- **Beliefs are legible and reversible**: anything Jarvis infers is visible to the user, carries
  provenance, and can be corrected, dismissed, or deleted.

## Implementation Slices (each its own plan)

This design is one coherent model but too large for a single PR. Implement in sequence:

1. **Sharing teardown** — replace workspaces with `shares`; simplify `AccessContext`; remove the
   `notes` module; migrate Tasks visibility. (Clears the deck; creates the clean seams.)
2. **Vault storage + `VaultContext`** — per-user root, optional import, traversal-safe I/O,
   OS perms, encryption-ready seam.
3. **Memory index + retrieval** — pgvector infra, ingestion pipeline, local `EmbeddingProvider`,
   `retrieve()` with provenance, rebuild.
4. **Structured state + write-back** — `commitments`, `entities`, `preferences`; frontmatter/body
   write-back; entity ↔ People-note linking.

The first plan we write covers **Slice 1**.

## Default Install (product note, for later)

By default a Jarv1s install ships **Briefing, Tasks, Calendar**, plus the ability to **connect a
note vault** and **connect email accounts** to bring in information. Recorded here for downstream
specs; not built by this one.
