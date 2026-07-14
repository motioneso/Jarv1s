# Memory presentation UX hardening (#992)

**Status:** Draft (awaiting UX Coordinator approval)

**Date:** 2026-07-13

**Grounded on:** `origin/main` @ `96d22ba0538896995f6d156b4fac641b6faa4fda`

**Tier:** sensitive (owner-private memory and wellness-derived context; no storage or policy change)

**Builds on:** #242–#245, #533, #562, #769;
`2026-06-27-user-editable-memory-dashboard.md`

## Problem

The memory dashboard is wired to real owner-scoped memory, but its extraction and presentation are
still implementation-shaped:

- `packages/chat/src/memory-distillation.ts` asks the model to extract “durable memory” without
  defining durable versus episodic. A completed medication event or other one-off state can
  therefore become a memory even though it does not help future answers.
- `packages/memory/src/dashboard-service.ts` deliberately returns both a graph-derived `title` and
  human `summary`. The web row renders both, so facts often repeat the same text while exposing the
  predicate in the title.
- `apps/web/src/settings/settings-memory-dashboard.tsx` prints raw item kinds, record kinds,
  confidence tiers, and statuses. Labels such as `fact`, `constraint`, and `inference` describe the
  storage model rather than what Jarvis knows.
- The dashboard uses `memdash-*` classes with no corresponding stylesheet rules, producing weak
  spacing and hierarchy.
- Pin and Forget do not explain their consequences. Worse, the Fact Forget handler calls
  `deleteMemoryEntity`, so it targets the entity DELETE route with a fact id instead of using the
  already-shipped fact DELETE route.
- Every tab uses “Nothing here.” History therefore looks broken when active memory exists, even
  though History intentionally contains only expired or superseded facts.

The result is technically functional but not self-explanatory. A user cannot reliably tell what a
record means, why it appears, what an action changes, or why one collection is empty.

## Decisions

1. **Keep one memory model and one dashboard contract.** This pass changes extraction guidance and
   web presentation only. It adds no table, migration, route, shared DTO, background job, or second
   memory store.
2. **Define durable memory at extraction time.** The existing distillation prompt will require
   stable preferences, goals, constraints, decisions, relationships, and facts likely to improve a
   future answer. It will return `[]` for completed one-off events, temporary status, medication
   doses taken, assistant-authored claims, questions, and restatements of active memory. A durable
   health regimen may be remembered only when the user explicitly asks; this pass does not infer
   wellness history into graph memory.
3. **Keep existing exact-signature dedupe.** `createMemoryCandidateSignature` and the owner-scoped
   unique constraint already collapse identical candidates. The prompt will avoid rephrased
   duplicates against the active-memory block. Do not add embeddings, fuzzy matching, a semantic
   dedupe service, or cleanup migration for this dogfood finding.
4. **Lead with the human statement.** A row uses non-empty `summary` as its headline and falls back
   to `title` only when needed. It never renders both when they repeat. Raw graph predicates remain
   backend-only.
5. **Translate or hide storage vocabulary.** Reuse and extend the existing
   `memory-provenance.ts` helper. Provenance becomes “You said this”, “You confirmed this”, “Jarvis
   inferred this”, or “Imported from a source”. Record kinds and lifecycle states receive concise
   sentence-case labels only when useful; generic `fact`, `candidate`, and `entity` badges are
   hidden. Confidence is phrased for people, not emitted as a raw enum.
6. **Explain collections in place.** Tabs become `Review`, `Memories`, and `History`. Each gets one
   short description and a specific empty state:
   - Review holds suggestions Jarvis will not rely on until accepted.
   - Memories holds facts Jarvis may use in future answers.
   - History holds only replaced or expired memories; it is not chat history, source history, or an
     audit log.
7. **Explain actions with visible, accessible copy.** Pin stays reversible and means “prefer this
   memory during recall”; it does not share, lock, or protect the record from forgetting. Forget
   permanently deletes the selected graph fact and deactivates its search document, while leaving
   the original chat/source record alone. The destructive confirmation states both consequences.
8. **Use the existing fact DELETE route.** Add only a web-client `deleteMemoryFact(id)` wrapper for
   `DELETE /api/memory/graph/facts/:id` and call it from Fact Forget. Entity deletion remains on
   `deleteMemoryEntity` inside `EntityActions`.
9. **Style with existing tokens and settings primitives.** Add the minimum `memdash-*` layout rules
   to `settings-panes-3.css`, which has room under the 1000-line gate. Use existing token variables,
   `Group`, `Segmented`, `Badge`, buttons, focus states, and feedback dialogs; no new component
   library or parallel settings design.

## Reconciled shipped contracts

| Existing behavior                                                | This pass                                                |
| ---------------------------------------------------------------- | -------------------------------------------------------- |
| Owner-scoped graph facts/candidates through `DataContextDb`      | Preserved                                                |
| `GET /api/memory/dashboard` DTO and status filters               | Preserved                                                |
| Exact owner + candidate-signature dedupe                         | Preserved; prompt also avoids active-memory restatements |
| Fact pin/lifecycle PATCH                                         | Preserved; consequence is explained                      |
| Fact DELETE route and transactional search-document deactivation | Reused by the missing web wrapper                        |
| Entity DELETE conflict/self protections                          | Preserved; still used only for entity rows               |
| Wellness energy-trend consent gate from #769                     | Preserved and re-run as a regression check               |
| Source summaries sanitized by #562                               | Preserved; no raw source ref or excerpt is newly exposed |

## Presentation contract

### Row

- Headline: trimmed `item.summary`, else `item.title`, else “Memory”.
- Do not show a second summary when it is equal to the headline after trimming/case folding.
- Show at most the useful human labels: memory type, provenance, confidence wording, lifecycle
  state, and updated date. Hide a label when its only value is generic (`fact`, `active`).
- Expanded metadata may show a safe source label and human-formatted dates. Keep conflict and
  supersession details in plain language; never expose ids.

### Review actions

Keep the existing backend operations, but use outcome language:

- `Accept` becomes `Remember`.
- `Reject` becomes `Not true`.
- `Suppress` becomes `Don’t suggest this again`, with copy that it affects similar future review
  suggestions rather than deleting active memory.

The edit-before-accept flow remains one inline form. No modal or ontology editor is added.

### Memory actions

- Pin/unpin shows a short description of recall preference next to the action.
- Forget opens the existing confirmation dialog with irreversible effect and source-retention copy.
- Success/error feedback remains in the existing accessible toast/alert system.
- Historical rows remain read-only except for operations the current contract already permits.

## Privacy, consent, and module boundaries

- Every list/mutation remains actor-derived and owner-scoped. No owner id is accepted from the
  browser and admins receive no private-data bypass.
- No new read of Wellness, chat, notes, email, calendar, or task tables is added. The memory module
  continues to render its own bounded DTO and safe source labels.
- The extraction job continues to receive one owner-scoped chat turn and up to 30 owner-scoped
  active memory facts under `DataContextDb`; no private content enters the pg-boss payload.
- The prompt must not turn a one-off medication event into durable graph memory. The existing
  consent-gated Wellness energy-trend contributor remains unchanged: consent off invalidates its
  derived fact, consent on keeps it owner-private.
- The UI must not reveal raw source refs, episode ids, fact/entity ids, excerpts, prompts, secrets,
  tokens, credentials, or cross-user data.

## Expected owned paths

Product:

- `~/Jarv1s/packages/chat/src/memory-distillation.ts`
- `~/Jarv1s/apps/web/src/api/memory-client.ts`
- `~/Jarv1s/apps/web/src/settings/memory-provenance.ts`
- `~/Jarv1s/apps/web/src/settings/settings-memory-dashboard.tsx`
- `~/Jarv1s/apps/web/src/styles/settings-panes-3.css`

Focused verification:

- `~/Jarv1s/tests/unit/chat-memory-distillation.test.ts`
- `~/Jarv1s/tests/unit/settings-memory-pane-provenance.test.ts`
- `~/Jarv1s/tests/unit/settings-memory-dashboard.test.tsx`
- `~/Jarv1s/tests/e2e/settings-memory.spec.ts`

Read/run but do not modify:

- `~/Jarv1s/tests/integration/memory-graph.test.ts`
- `~/Jarv1s/tests/integration/memory-dashboard.test.ts`
- `~/Jarv1s/tests/integration/wellness-energy-trend-consent.test.ts`
- `~/Jarv1s/tests/integration/wellness-phase2.test.ts`

`tests/uat/**` is explicitly excluded; the UX Coordinator owns that tree and the final live
walkthrough.

## Acceptance

- [ ] A completed one-off medication event and other temporary/episodic updates are explicitly
      excluded by the distillation contract; stable user-requested memory remains allowed.
- [ ] Exact duplicate candidates still collapse through the existing owner-scoped signature, and
      the prompt tells the model not to restate active memory.
- [ ] Each row presents one human statement without predicate/title duplication.
- [ ] Raw item-kind, record-kind, provenance, status, and confidence enums are translated or hidden.
- [ ] Review, Memories, and History each explain their contents and have distinct honest empty
      states.
- [ ] Pin explains that it raises recall preference and is reversible; it does not imply sharing,
      permanence, or protection.
- [ ] Forget explains that the graph fact is permanently removed from memory/search while the
      original source remains, and Fact Forget calls the fact DELETE route exactly once.
- [ ] Entity deletion still calls only the entity DELETE route.
- [ ] Desktop and narrow layouts preserve readable hierarchy, keyboard focus, wrapping, and action
      reachability without horizontal overflow.
- [ ] Dashboard reads/actions remain owner-only; user A cannot read or delete user B’s fact.
- [ ] Wellness-derived recall remains consent-gated and owner-private; no new cross-module query or
      data exposure is introduced.
- [ ] Focused unit, integration, and Settings-path E2E checks pass, followed by design-token and
      foundation gates.

## Live-path proof

After automated checks, the UX Coordinator’s live pass should use two owner accounts and the real
Settings route:

1. Open Memory & context and verify Review, Memories, and History explain themselves at desktop and
   narrow width.
2. Inspect an active memory: one human statement, no raw predicate/enums, readable source and dates.
3. Pin then unpin it and confirm the help text matches the visible state.
4. Forget a disposable fact, confirm it disappears from Memories/recall while its source chat
   remains, and confirm a second owner cannot see or act on it.
5. Submit a one-off medication update in chat and confirm no durable memory is created; explicitly
   ask Jarvis to remember a stable non-sensitive preference and confirm it does appear.
6. With Wellness AI consent off, confirm no derived energy-trend fact becomes available to recall.

## Non-goals

- No migration, schema/DTO change, new API route, memory cleanup job, or backfill of existing text.
- No semantic/vector dedupe service, fuzzy matcher, model-based truth adjudication, or bulk merge UI.
- No redesign of memory storage, confidence math, recall ranking, source provenance, or candidate
  promotion policy.
- No editing source chats/notes, global provenance browser, audit log, or chat-history work.
- No Wellness consent-policy change or new wellness-to-memory integration.
- No edits under `tests/uat/**`, no unrelated Settings shell/IA work, and no product changes outside
  the explicit owned paths.
