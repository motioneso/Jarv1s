# Spec revision 2 — default-allow settings writer (epic #1262)

Revise `docs/superpowers/specs/2026-07-27-settings-default-allow-writer.md` **in place**. Keep its
structure, status line, and everything not listed below. Re-verify every code path cited here rather
than trusting this brief. Commit by explicit path. **Spec only — no code, no PR.**

Revision 1 went to an adversarial review (Fable 5, 2026-07-27), which returned **DO NOT APPROVE** on
four blockers. Ben has ruled on all four. Three are fixes to this spec; one is filed elsewhere.

## Level of detail — read this before you start

The spec states **what must be true**: contracts, invariants, failure modes, and test cases. It does
not contain implementation code, type definitions written out, or file-by-file refactor instructions.
Where a fix below needs a mechanism, name the mechanism and the property it guarantees, and leave the
implementation to the build. Ben confirmed this level explicitly — do not drift into code.

---

## A. Blockers to fix

### A1. The central safety claim is not currently specifiable. This is the important one.

The spec's entire safety case is "an unclassified setting fails the build" (lines 97-98, 114, and
verification criterion 11). That is asserted, not specified, and as written it cannot be enforced.

Verified on this branch: `app.preferences` is a **general-purpose per-user key-value store**, not a
settings store. `PreferencesRepository.upsert(scopedDb, key: string, value: unknown)` at
`packages/structured-state/src/preferences-repository.ts:9` takes an arbitrary string key, and it is
called from packages that have nothing to do with settings:

- `packages/wellness/src/routes.ts:116` — writes `WELLNESS_AI_CONSENT_PREFERENCE_KEY`. Note that
  this is a **private-data-scope consent value**, i.e. deny category 5, living in the same undifferentiated
  store as ordinary preferences.
- `packages/connectors/src/monitor-jobs.ts:81` — writes connector monitor status.
- Plus chat, notifications, calendar, email, and module-registry call sites.

A settings write and an internal-state write are therefore **type-identical**. No build gate can tell
which `.upsert()` call skipped the registry, so "unclassified fails the build" degrades to exactly
the convention the spec claims to replace.

**Fix.** Specify that registry-owned settings have their own distinguishable write path, and that
this path — not the shared preferences port — is the only way a setting value reaches storage. State
the property the build gate asserts on, and state the settings key namespace (or equivalent
discriminator) that makes a settings row identifiable from a non-settings row. Then re-word
verification criterion 11 so its second sentence is actually testable: today "adding a settings write
path without a registry declaration also fails the build" cannot be checked by any mechanical means.

Constraint: **do not retype or narrow the shared `PreferencesPort`** to achieve this. Six-plus
packages depend on it for non-settings state; forcing settings types through it would break module
isolation (a CLAUDE.md hard invariant). The settings path is additive.

### A2. The spec never says where `settings.set` can be reached from.

Default-allow plus silent execution plus content the assistant ingests is the shape of a known real
attack: **CVE-2025-53773**, in which indirect prompt injection persuaded GitHub Copilot to enable its
own YOLO mode with no prompt shown to the user, reaching code execution. Jarvis reads the owner's
notes, web content, connector content, and module output; all of it can carry an injected
instruction, and every guardrail this spec lists (validation, authorization, CAS, undo, audit, rate
limiting) passes a semantically-valid injected write cleanly.

**Fix, two parts.**

1. State the reachability boundary explicitly: `settings.set` is available **only in the owner's own
   interactive chat**. It is not reachable from module-invoked AI, background/scheduled AI, digest or
   briefing generation, or any non-interactive invocation path. Say so as an invariant, and add a
   verification criterion proving a background/module invocation cannot call it.
2. The audit is metadata-only (line 289) and has no owner-visible surface, which makes undo
   theoretical — you cannot undo a change you never learned about. Add an **owner-visible record of
   settings changes made by the assistant** (what changed, when, from what to what, and in which
   chat). Keep it metadata-only. This is a small addition to scope and Ben has approved it.

Also strengthen the injection treatment in the spec's own words. It currently reasons about a
crafted *tool call*; the real threat model is a crafted *instruction* that produces a perfectly legal
tool call.

### A3. Concurrency and undo are undefined for the module operations the spec newly made writable.

The write flow's optimistic-concurrency step (line 289, step 7) and the undo record (step 9) both
assume a `revision` anchor. That column exists on the preferences and instance-settings tables. It
does **not** exist on the tables module enable/disable actually writes — verified around
`packages/settings/src/routes-modules.ts:118`, `:208`, `:294` (`instance_module_deny`,
`user_module_deny`, and the downloaded-module state).

So the two operations Ben's ruling newly admitted to the writer are precisely the ones whose conflict
and undo behaviour the spec does not define.

**Fix.** Specify concurrency and undo for revision-less targets: what the declaration supplies in
place of a revision, what "conflict" means there, and what undo does when the current state no longer
matches what was recorded. Fail closed — an undo that cannot prove it is reversing its own change
must decline rather than overwrite.

### A4. State the module trust boundary accurately, and correct one factual claim.

The spec says the curated index is the trust boundary. That is directionally right but overstated as
written:

- The index is fetched over TLS from a single GitHub release and is **not signed**
  (`distribution/registry-source.ts:9`). Artifacts are sha256-checked *against the index*; nothing
  verifies the index.
- **Download only stages a module** (`packages/settings/src/routes-module-registry.ts:133-160`).
  **Enable is the step that starts its code running** (`packages/settings/src/routes-modules.ts:207-214`).
  A validated manifest is not the same as safe code.
- Verify and correct: the review found that only *disable* checks `supportsUserDisable`
  (`routes-modules.ts:288`) while *enable* is unconditional. The spec's module table currently claims
  per-user enable requires that manifest flag. Check this yourself and state what is actually true;
  if the spec is asserting a check that does not exist, say what the declaration must enforce instead.

**Fix.** Say plainly that enable is the code-execution step, describe the index trust honestly, and
add a verification criterion that a module id **not present in the verified index is rejected**,
including on a direct API call.

**Do not add index signing to this spec.** Ben's ruling: the risk is real but is its own piece of
work, and the index is his own today. It is filed as **issue #1319**. Record the residual risk in one
or two sentences and reference #1319.

---

## B. Should-fix

- **B1. The raw-key REST twin.** `PATCH /api/admin/settings/:key` (`packages/settings/src/routes.ts:497`)
  is a raw-key write path guarded only by an allowlist, and it can write deny-category keys
  (`instance-settings-keys.ts:17-23`). The spec bans a raw-key *tool* while leaving its REST
  equivalent in place. The migration section must dismantle or front this route through the registry
  — "route it through apply" is not enough if the key itself still arrives as a free-form parameter.
- **B2. Gameable verification criteria.** The stated goal is that the feature cannot pass while
  broken. Three criteria can be satisfied by a broken implementation:
  - Criterion 5 ("no confirmation card") is trivially true if nothing prompts at all. Add an
    assertion that the install-time grant actually exists, and that a *denied* attempt is still
    refused.
  - Criterion 11 — split it. The classification half is mechanically checkable; the "settings write
    path without a declaration" half is not, until A1 is specified.
  - Criterion 16 — add the non-index module id rejection from A4.
- **B3. Reversible is not the same as harmless.** Quiet hours plus notification-disable can silently
  drop a time-sensitive alert; undoing the setting afterwards does not deliver the alert that never
  arrived. The spec currently treats reversibility as sufficient. Name this residual risk explicitly
  in the classification section rather than leaving it implied.

## C. Corrections — the spec states these as fact and they are false

- **Hermes Agent does let its assistant configure the app** (`hermes config set`, `hermes skin set`).
  Line 30 currently cites it as an assistant that does not. Verify, then correct it: it is a
  **contrary precedent**, not a supporting one. Adjust the surrounding argument honestly — it makes
  the "not established practice" claim weaker, and the spec should say so rather than quietly drop it.
- **microsoft/vscode#187141 is closed (not planned)**, not "an open request" (line 28). Verify and
  correct. Check whether the design conclusion drawn from it still stands once the fact is right; if
  the conclusion survives for a different reason, say that reason.
- **Cite CVE-2025-53773** in the deny-category-3 argument. It is the strongest available precedent for
  why self-operation authority must be centrally denied, and it is a documented real-world instance
  rather than a hypothetical.

The Home Assistant, VS Code `contributes.configuration`, MCP annotation, and Cursor claims were
verified accurate — leave them.

## D. Unchanged

Everything in the spec's "What survives from the superseded spec" stands. CLAUDE.md hard invariants
apply — no admin private-data bypass, private by default, `DataContextDb` only, `AccessContext` is
`{actorUserId, requestId}` only, secrets never escape, metadata-only payloads, provider-agnostic AI,
module isolation, never edit applied migrations (`0175`/`0176`/`0177` FROZEN).

Ben's rulings are not open for re-argument: default-allow; modules are writable (install, instance
disable/re-enable, per-user enable); no routine confirmation prompts; remove/purge stays carved out
to a separate confirming tool. Work within them.

Update "Open decisions" honestly. If any fix above surfaces a genuine product fork, mark it for Ben
rather than settling it yourself.
