# JS-08 — opportunity feed, decisions, and assistant reads

**Status:** Draft — issue #937; pending Ben's final approval

**Grounding:** grounded on `eafa22dd`

**Depends on:** #935 and #936

## Goal

Expose the stored ranked feed in the module UI and compact assistant tools so users can understand,
save, or pass on each opportunity without turning MVP into an application CRM.

## Views

`new`, `saved`, `passed`, and `stale` are discovery decisions/states, not application stages. Cards
show title, company, location/work arrangement, source, published/first-seen date, freshness, fit
band, confidence, top evidence, and top gap. Detail shows the capped description snapshot,
truncation, full evaluation evidence/gaps/unknowns, and profile/resume/content revisions used.

List responses use the compact feed index and never include descriptions. Detail retrieves one
bounded record. Pagination/limits prevent returning the full 500-record store at once.

## Tools and decisions

- opportunities list/get: read;
- opportunity decide: write + confirm, accepting `saved | passed` and an optional bounded reason;
- monitor health summary: read.

Decisions bind the actor, audit through `AssistantToolGateway`, update the canonical opportunity,
and rebuild the derived feed. Saved records are protected from automatic eviction. Feedback stays
owner-private and does not train a shared model or automatically alter ranking in MVP.

## UI behavior

Filters have stable URLs beneath the module Root. Cards and details render external content as text.
Optimistic updates may change only presentation; canonical state comes from the confirmed tool
result. Empty/degraded states distinguish “no credible matches” from source/AI failure.

## Verification

- UI/tool list and detail schemas agree and remain bounded.
- Description is detail-only; truncated state is explicit.
- Saved/passed writes confirm, audit, and survive disable/re-enable.
- User A/admin cannot see user B's feed or decisions.
- Protected saved retention and passed eviction/tombstone behavior.
- Keyboard/filter/detail accessibility and external-text safety.

## Review question

Should decision reasons remain optional free text, use a small reason enum plus optional note, or be
omitted from MVP? This does not block core feed behavior but affects the JS-08 schema.
