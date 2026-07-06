# Explicit page element selection for Jarvis context (#745)

**Status:** Parked — 2026-07-05, Ben deferred further spec work pending a clearer real-world
use case (see open questions below — deliberately left unresolved; do not pick this back up
without checking with Ben first)
**Date:** 2026-07-05
**Tier:** security-sensitive (redaction/secrets surface)
**Builds on:** #679 / docs/superpowers/specs/2026-07-04-page-aware-chat-context.md

## Problem

V1 page awareness (#679) gives Jarvis a sanitized whole-page snapshot plus best-effort
focus/selection when a browser focus or text selection naturally exists. It has no way for a user
to *intentionally* say "this specific thing, right here" — a settings row, a stat tile, a card —
and ask a targeted question about only that element. #745 owns that richer, deliberate
point-and-select interaction: hover/highlight a UI element, click (or keyboard-select) it, and ask
Jarvis about it with tightly scoped, sanitized context instead of the full-page snapshot.

**Dependency risk:** #679 is spec-approved (`docs/superpowers/specs/2026-07-04-page-aware-chat-context.md`,
comment-confirmed on the issue) and labeled `RFA`, but as of this writing there is no
`pageContext`/`PageSnapshot`/page-aware-chat-context implementation in the tree (no matching files
under `apps/web` or `packages/chat`, no landed PR referencing #679). **#679's client-side capture
layer, snapshot data model, and field-privacy/redaction classifier do not exist in code yet.** This
spec defines #745's interaction and data shape assuming #679 lands first and exposes a reusable
"produce sanitized context for a DOM node" primitive; #745 should not be built before #679, and if
#679's actual implementation shape differs materially from its spec (e.g. a different sanitized
snapshot schema), this spec's field list in §3.4 will need a compatibility pass rather than a
rewrite from scratch.

**Naming note:** the issue calls this "Agentation-style" element selection. The `mcp__agentation__*`
tools available in this session are a *human developer feedback* annotation toolbar for a completely
different workflow (devs annotating the app's own UI to leave notes for an agent) — they are not
infrastructure #745 imports or calls. "Agentation-style" here means only the interaction pattern
(hover → highlight → click-to-select → contextual annotation/question), reimplemented natively for
end users inside the Jarvis chat surface.

## Scope

### 3.1 Entry point

Primary entry point: a "select an element" affordance next to the chat input (icon button), visible
whenever chat is open on a Jarvis web page. Activating it enters selection mode on the current page.
Secondary entry point: a keyboard shortcut (exact binding TBD, see open questions) that toggles the
same mode without requiring a mouse trip to the chat input first. There is no page-UI-side entry
point independent of chat (e.g. no always-on inspect icon floating over arbitrary page furniture) —
selection mode only exists in service of asking chat a question, consistent with #679's "supplied
only when the user asks from chat" principle.

### 3.2 Hover/highlight overlay behavior

While selection mode is active:

- Hovering the pointer over a candidate element draws a lightweight outline/focus-ring directly on
  that element (no full-page dimming/mask layer — keep it cheap and avoid a heavy modal-like AI
  tell, consistent with the project's authored-design-system discipline).
- "Candidate element" is resolved by walking up from the raw hover target to the nearest ancestor
  that is a meaningful semantic unit (has an ARIA role, is a labeled form control, a card/list-item
  container, a heading, or a button/link) rather than highlighting arbitrary `<div>` wrappers or
  text nodes. Exact candidate-resolution heuristics are an implementation detail, not a spec
  decision, but must be deterministic and testable.
- Clicking the highlighted element selects it: selection mode ends, the element's sanitized context
  (§3.4) is attached to the next chat message the user sends, and the chat input gets a small
  "selected: <short label>" chip so the user can see and clear what's attached before sending.

### 3.3 Keyboard, escape, and accessibility behavior

- `Escape` exits selection mode at any time, from any state (hovering, nothing hovered yet, or
  immediately after activation), with no side effects and focus returned to the chat input.
- Selection mode must be fully operable without a pointer: `Tab`/`Shift+Tab` cycle through candidate
  elements on the page in DOM order while mode is active; `Enter`/`Space` selects the currently
  focused candidate, mirroring the click behavior in §3.2.
- Mode entry/exit and the current selection state are announced via an `aria-live="polite"` region
  ("Element selection mode active. Tab to a page element, Enter to select, Escape to cancel.") so
  screen reader users get the same affordance non-visually.
- The highlighted/focused element gets a visible focus ring meeting the app's existing contrast
  tokens (`apps/web/src/styles/tokens.css`), not a new ad hoc color.

### 3.4 Sanitized element context captured

Reuses #679's sanitization vocabulary and posture (strip everything but a small allow-listed set of
fields), scoped to one element instead of the whole page:

**Included:**
- Resolved semantic role (ARIA role or equivalent semantic tag/element type).
- Accessible label/name (aria-label, associated `<label>`, or button/link text).
- Visible text content of the element, trimmed and length-capped.
- Nearest preceding/ancestor heading text, for "what section is this in" context.
- Current route/page title (same fields #679 already includes for the whole-page snapshot).
- `data-testid`/`data-id`-style attributes **only** when they don't match a sensitive-value shape
  (no embedded emails, tokens, UUIDs tied to private records treated as opaque secrets, etc.) —
  "when safe" per the issue, meaning: allow-list the attribute *name* pattern, then still run the
  *value* through the same redaction pass as every other captured string.

**Excluded, unconditionally:**
- Raw DOM/HTML, arbitrary attributes not on the allow-list above.
- Any element that is `hidden`, `aria-hidden="true"`, `display:none`, or otherwise not visibly
  rendered — excluded entirely (no role/label/text captured at all), not merely redacted.
- Values of password/secret/token/credential fields, connector/AI credentials, session tokens — per
  the CLAUDE.md "secrets never escape" invariant, which is non-negotiable and applies here exactly
  as it does to #679's page snapshot.
- Values of fields #679's field-privacy classification marks sensitive (financial, health, and
  similar private-value fields) — label/role may still be captured (e.g. "this is your bank account
  number field") but the value itself is never captured, matching #679 §2/§5.

### 3.5 Redaction rules

Element context goes through the same sanitize/redact pass #679 defines for whole-page snapshots
before it is ever attached to a chat turn — this spec does not invent a second redaction pipeline.
Concretely: secret/token/password/session values are never captured (not captured-then-redacted;
simply never read from the DOM in the first place, mirroring `packages/ai/src/adapters/redact.ts`'s
posture of defense-in-depth even though that module handles a different kind of leak). Hidden
content is excluded before sanitization runs, not filtered after. If #679 ships a shared
sanitize/redact utility, #745 must call it rather than reimplementing field-privacy classification
locally — this is the concrete form of "Builds on #679" for this feature.

### 3.6 Lifecycle: per-turn, per-thread, or memory-eligible

Selected-element context is **per-turn by default**, narrower than #679's whole-page snapshot (which
#679 keeps as "latest inspected" volatile state across follow-ups within a session). A user's
element selection is a deliberate, one-off pointing gesture tied to the message they're about to
send — it should not silently keep answering unrelated follow-up questions as if the user were still
pointing at that element.

Proposed behavior: the selected element's context rides with the message it was attached to, plus
is available as fallback context for the immediate next 1–2 follow-up turns in the same thread if
the user's question doesn't include a new page-context signal (matching #679's existing "this/here"
follow-up handling) — then it expires. It is never written into durable transcript metadata, memory,
logs, or pg-boss job payloads (metadata-only job payload invariant). Consistent with #679 §2/§5:
Jarvis may still extract derived, user-relevant *facts* from the resulting conversation through the
normal memory pipeline, but never the raw captured element context, and private/incognito chat
disables memory writes exactly as it does for #679.

## Non-goals / Guardrails

- No reuse of the `mcp__agentation__*` MCP tools as infrastructure — they belong to a separate
  human-developer-feedback workflow; only the hover/highlight/select *interaction pattern* is a
  reference here.
- No full-page snapshot behavior change — that is #679's surface, unmodified by this spec.
- No screenshot-based or vision-based element capture; this stays DOM/accessibility-tree based, same
  posture as #679.
- No raw DOM/HTML ever crosses into a chat prompt, log, or stored record — hard invariant, not a
  design preference.
- No secret, hidden, or field-privacy-sensitive *value* ever reaches the AI prompt, regardless of
  whether the user explicitly selected the element containing it. Explicit user intent to select an
  element does not override field privacy or the secrets-never-escape invariant.
- No standing/session-long "sticky" selection — selection is short-lived per §3.6; this spec
  deliberately keeps it narrower than #679's per-thread snapshot carryover.
- Do not build this before #679 lands; #745 depends on #679's capture/redaction primitives existing
  to call into, not on re-deriving field-privacy classification independently.

## Open questions (for Ben)

1. **Keyboard shortcut binding** for toggling selection mode without going through the chat-input
   button — no strong default candidate identified; needs a binding that doesn't collide with
   existing app or browser shortcuts.
2. **Overlay visual treatment** — is a simple outline/focus-ring sufficient, or does Ben want a
   dimmed backdrop over non-candidate content (heavier, more "inspector tool"-like, closer to a
   devtools/Agentation feel but a bigger design lift and a possible AI-tell risk per the design
   review history)?
3. **Multi-turn expiry window** (§3.6) — is "falls back for up to ~2 follow-up turns" the right
   default, or should selected-element context be strictly single-turn only, with no fallback at
   all (simpler, more private, but less forgiving of a natural "and this one?" follow-up)?
4. **`data-id`/`data-testid` capture** — is capturing these attribute values at all worth the
   surface area, given the redaction pass needed to make it safe, or should this spec drop them
   entirely from v1 and only carry role/label/text/heading?
5. **Candidate-element resolution granularity** — should users be able to select arbitrarily nested
   elements (drill down/up, e.g. via modifier+click or a secondary key), or is "nearest meaningful
   semantic ancestor" (§3.2) a fixed, non-adjustable default for v1?
6. **Compatibility contingency** — if #679 ships with a sanitized-context data shape different from
   what's assumed here, does #745 wait for a spec addendum, or is a compatible reshape considered
   in-scope for whoever builds #745?

## Acceptance criteria

- User can intentionally enter an explicit element-selection mode (from chat input button or
  keyboard shortcut) and select exactly one visible Jarvis UI element to attach to a chat question.
- Jarvis receives only the sanitized element context defined in §3.4 — never raw DOM, never
  arbitrary attributes, never secret/token/password values, never values of field-privacy-sensitive
  fields (label/role may still be present for such fields; the value never is).
- Hidden/non-rendered elements cannot be selected and contribute no context.
- Selection mode is cancellable at any point via `Escape`, with no side effects.
- Selection mode is fully operable by keyboard alone (`Tab`/`Shift+Tab` to cycle, `Enter`/`Space` to
  select) and announces mode state changes via an `aria-live` region for screen readers.
- Selected-element context is per-turn by default, with at most the bounded multi-turn fallback
  window from §3.6, and is never persisted to durable transcript metadata, memory, logs, or pg-boss
  job payloads; private/incognito chat disables any memory writes derived from it.
- Tests cover: redaction (secret/sensitive/hidden values never appear in captured context), keyboard
  operability (mode entry/cycle/select/escape), and selected-element context correctly attached to
  and delivered with the chat turn it was selected for.

## Files likely in play (build-time, non-binding)

- `~/Jarv1s/apps/web/src/chat/*` (chat input affordance, selection-mode UI)
- `~/Jarv1s/packages/chat/src/live/*` (turn payload carrying selected-element context)
- `~/Jarv1s/packages/shared/*chat*` (shared contract types, extended from #679's snapshot shape)
- Whatever new module #679 introduces for sanitize/redact/field-privacy — #745 should depend on it,
  not fork it.
