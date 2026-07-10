# Intelligent job search — settled decision record

**Status:** Settled by delegated Fable approval; PR remains draft pending Ben's final sign-off

**Date:** 2026-07-10

**GitHub:** #913

**Grounding:** grounded on `eafa22dd`

---

The six product/scale forks from the initial draft are settled below. Rejected options have been
removed. These decisions are folded into the module design and future task scopes.

## D1 — Deterministic gate plus AI fit bands

Hard deterministic exclusions run first. New or materially changed survivors receive
schema-validated AI fit bands, capped at 25 evaluations per user per local day. Pending backlog is
processed oldest-first. The module requests the `interactive` tier for the `json` capability and
never a provider or model; admin bindings still choose the actual route. Every result includes
evidence, gaps, freshness, confidence, and explicit unknowns; no opaque precision percentage.

**Applied to:** JS-07.

## D2 — Greenhouse, Lever, Ashby, and manual capture

MVP ships keyless public Greenhouse, Lever, and Ashby board adapters plus one-shot manual public-URL
and pasted-description capture. No authenticated board, cookie/session use, known-prohibited source,
or recurring generic scraper is allowed. Each recurring adapter has exact hosts, policy review
URL/date, courtesy interval, stable identity semantics, and a fail-closed kill-switch posture.

**Applied to:** JS-04.

## D3 — Capped Markdown resume revisions

Resume input is capped at 48 KB UTF-8 so each immutable normalized Markdown revision plus metadata
fits below `module_kv`'s 64 KB JSON-value limit. The original pasted text is retained unchanged as
its own capped `revision/0` provenance value. Oversize input is rejected before write with a clear
48 KB limit message. No chunking, PDF/DOCX parsing, or #914 dependency enters MVP.

**Applied to:** JS-02 and JS-03.

## D4 — Full onboarding and required starter action

MVP uses all six checkpoints: resume intake, critique, truth-guarded approval, search profile,
sources/schedule, and final review/enable. One-click module-to-assistant launch is required. #916 is
narrowed to the small generic host starter action specified alongside these docs. Briefings dispatch
is outside MVP and is not part of #916's build scope.

**Applied to:** #916, JS-03, and JS-06.

## D5 — Bounded KV retention

- Target 500 opportunities per user after evicting eligible records.
- Maximum 16 KB normalized description snapshot per opportunity, with truncation marked.
- Active and saved opportunities never auto-evict.
- Protected active/saved records may overflow the target; saving is never refused to enforce it.
- Passed/stale opportunities evict after 30 days or oldest-first when over the cap.
- Eviction leaves a compact identity-hash tombstone with a 60-day TTL to block rediscovery.
- Run history retains the most recent 50 runs or 14 days per monitor, whichever is smaller.

These bounds keep #914 out of the MVP critical path.

**Applied to:** JS-02 and JS-05.

## D6 — Periodic local due-check

The manifest declares one hourly static tick. Its handler reads the user's local due time and
last-run local date from KV, performs no network/AI work when not due, runs real discovery at most
once per local day, and performs no missed-interval replay or catch-up storm after downtime.

**Applied to:** the replacement #915 schedule task and JS-05.

## D7 — Post-merge seven-day usefulness validation

Automated and day-one manual acceptance gate implementation merge. The seven-day real-market
observation runs after merge/deployment while epic #913 remains open. Findings may drive changes or
child tasks. #913 closes only after the usefulness result and any required corrective work are
recorded.

**Applied to:** JS-09 and #913 closeout.

## Approval record

Fable, acting as delegated approver, returned APPROVE-WITH-CHANGES on PR #929 and settled D1–D6 as
recorded above. The PR stays draft: these decisions authorize finalizing specs and filing task
issues, not implementation planning, build lanes, readiness, or merge before Ben's final sign-off.

Ben subsequently settled the source location, protected-record overflow, `interactive` AI tier,
hourly due-check, and post-merge seven-day validation recorded in the current revisions.
