# #1109 — Jarvis knows WHERE IT IS (runtime situational awareness)

Status: design (needs-spec → spec). Coupled with #1110 (app map). Both share the
contracts in §7; keep that section identical in both specs.

North star: **Jarvis knows Jarvis and never invents.** This spec covers the _runtime_
half — what the user is looking at right now. #1110 covers the _static_ half — the map
of every screen/setting and what each error means.

---

## 1. Problem

Today `<page_context>` is **pushed** every turn by the client
(`packages/chat/src/live/page-context.ts` — "client-captured", projected into
`engineText` for a single turn, never persisted). It bloats every turn including idle
chat, and it is the client's decision what to send. When the user asks "what does this
error mean," Jarvis has only whatever text happened to be pushed, plus its own
imagination — the origin failure.

## 2. Design

### 2.1 Push → Pull

Convert the per-turn push into a **pull-on-demand read tool** (`risk:"read"`, exposed via
the existing gateway path, `runReadToolForActor`). Idle chat costs zero. When the user
asks about the current screen, Jarvis calls the tool and gets one bounded snapshot.

The client keeps a **live per-session "current view"** fresh (same capture logic that
exists today, minus the per-turn transmit). The tool reads the latest cached snapshot for
that session. Reuse the TTL/reuse policy already unit-tested in `resolveCachedPageContext`.

### 2.2 Two-tier "seeing" — with a hard redaction floor

- **Tier 1 (light, default, always allowed):** the existing bounded projection
  (`projectPageContextSnapshot`): route, page title, headings, buttons, labels, visible
  text, focused element, selected text — already redacted (field _values_ excluded),
  capped to 6 KB, prompt-injection-neutralized (`neutralizeSeedFraming`). This is the
  default and covers the origin use-case (on-screen error text + code).
- **Tier 2 (heavy: fuller DOM / screenshot):** gated. See §5 (Critical finding F2). Not a
  free escalation the model can take at will.

### 2.3 Server facts in the snapshot

Attach server-authoritative facts the DOM can't be trusted for:

- **app version / build id** (today only `CORE_VERSION="0.1.0"` exists; a build-info read
  is needed — see #1110 §build stamp),
- **platform** (web / desktop / etc.),
- **selected model capabilities** — expose at **capability level** (chat/tool-use/json/…),
  _not_ raw model identity, to stay on the right side of the #953 seam (modules receive
  capability booleans, not model identity). Model _name_ only if it is already user-facing
  in settings.

These server facts are what let #1110 resolve an error to a fix (e.g. "no json-capable
model bound" → the news add-source dead-end).

## 3. Anti-hallucination coupling

This snapshot tells Jarvis the _symptom_ (error text + code on screen, current route,
current model capabilities). #1110's map turns that symptom into a _named fix or an honest
"I don't know."_ Neither works alone. The snapshot MUST carry any machine-readable
`errorCode`/`errorClass` the UI has (see §7 error contract) so #1110 can classify the
error by construction rather than by guessing at prose.

## 4. Security — the pull doesn't change the boundary

The light snapshot reflects only the requesting user's own rendered DOM; it is captured
client-side and re-projected server-side as untrusted input (unchanged from today). No
cross-user surface: the tool runs under the actor's `withDataContext` and reads only that
session's cached view. Fine as-is for Tier 1.

## 5. Findings folded in (this spec's share)

**F2 (Critical) — Tier-2 heavy capture bypasses the redaction floor.** A raw DOM dump or
screenshot contains everything the light projection deliberately strips: field _values_,
other on-screen module content, PII, secrets in inputs. Escalating "if the light pass is
insufficient" hands the model a way to exfiltrate exactly what Tier 1 protects.
Resolution:

- **Full-DOM tier** must pass through the **same projection/redaction/cap pipeline** as
  Tier 1 (extended field set, same value-stripping and injection-neutralizing). No raw
  `innerHTML` reaches the model.
- **Screenshot tier**: image content cannot be text-redacted or RLS-scoped. **Off by
  default.** Only on **explicit per-capture user action** (user clicks "show Jarvis this
  screen"), never model-initiated, and flagged in the UI while active. If that consent
  UX isn't in scope now, **drop screenshots from v1** and ship DOM-tier only.
- The model **cannot self-escalate** to Tier 2. Escalation is a user affordance or a
  narrowly-scoped tool the user consents to per call — see §6 boundary.

**F6 (Important) — light/heavy boundary underspecified.** "Escalate if insufficient"
leaves the decision to the LLM = a cost and privacy footgun (it can always ask for a
screenshot). Resolution: define the boundary explicitly (§6).

**F10 (Minor) — model identity vs #953 seam.** Prefer capability-level exposure; only leak
model name if already user-visible. (Folded into §2.3.)

## 6. Light/heavy boundary (spec-precise)

- Default and model-reachable: **Tier 1 only.**
- **DOM tier**: separate read tool, still auto-callable, but output goes through the full
  redaction pipeline; larger cap (state a number, e.g. 16 KB to match `renderAndCap`), and
  only the _structural_ DOM (roles, labels, text nodes) — never attributes that carry
  values (`value`, `data-*` with content, `src` with tokens).
- **Screenshot tier**: user-gated, per-capture consent, UI indicator, not model-initiated.
- A turn that needs more than Tier 1 and has no consented Tier 2 available returns an
  honest "I can see the page structure but not that detail — can you paste the exact text?"
  rather than inventing.

## 7. Shared contracts (identical in #1110)

### 7.1 Structured error contract

Every first-party error surface emits, alongside its human string, a machine-readable
envelope the snapshot can carry and the map can resolve:

```
{ code: string,            // stable, e.g. "news.add_source.no_json_model"
  class: "prerequisite" | "transient" | "validation" | "permission" | "bug",
  remediationRef?: string  // key into the #1110 map when class==="prerequisite"
}
```

- `class==="prerequisite"` → #1110 resolves `remediationRef` to a named fix.
- every other class → Jarvis states honestly what kind of error it is and does **not**
  fabricate a settings fix (see #1110 §"no _unexplained_ errors").

### 7.2 Provenance contract

Any assistant answer about app structure/behavior/errors must be grounded in a preceding
successful map/snapshot tool call. Answers about the app with no such call are a
detectable failure the eval suite (§7.3 in #1110) asserts against.

## 8. UAT exit criteria (#1000 harness, hard gate)

- Playwright: trigger the real news add-source dead-end, open chat, ask "what does this
  mean" → Jarvis names the fix ("bind a json-capable economy model in Assistant & AI") and
  deep-links `/settings?section=assistant`. No invented answer.
- Idle chat sends no page context (assert zero snapshot pull on turns that don't ask).
- Screenshot tier (if shipped) requires an explicit click; assert no model-initiated
  screenshot.

## 9. Explicitly out of scope

Live source-tree reading in prod (Ben rejected). No source in image, no source mount.
Runtime knowledge = the bounded snapshot here; static knowledge = #1110's declared map.
