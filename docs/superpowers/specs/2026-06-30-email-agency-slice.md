# Email agency: reply drafts + sends under the action-family trust model (#214 slice-3)

**Status:** proposed (awaiting model-diverse spec-merge gate + Ben build go-decision)
**Date:** 2026-06-30
**Owner:** Ben + Stanley (hive)
**Grounded on:** `315b0972` (local `main`)

**Source grounding (read, not remembered):**

- `packages/ai/src/gateway/policy.ts` — `resolvePolicy` (read→run, destructive→confirm, write→confirm
  unless family `tier===trusted_auto` AND `tool.executionPolicy==="auto"` AND
  `allowedTiers.includes("trusted_auto")`). Destructive floor is unconditional.
- `packages/ai/src/gateway/gateway.ts` — confirm-and-run bridge: persists only
  `inputSummary: summarizeAssistantToolInput(input)` (key NAMES only), holds raw input in-memory,
  streams an `action_request` chunk (`{actionRequestId, toolName, summary}`) to the chat, executes on
  approval.
- `packages/ai/src/assistant-tools.ts` — `summarizeAssistantToolInput` returns `{inputKeys, inputKeyCount}`;
  per-tool `summarize` produces the human-facing card line.
- `packages/calendar/src/calendar-write-service.ts` + `packages/calendar/src/manifest.ts` — the proven
  synchronous module-write pattern (`calendar.proposeFocusBlock` write via `requiresServices:["calendarWrite"]`;
  `calendar.deleteEvent` write under family `calendar_management` locked to `always_confirm`). This spec
  mirrors it for email.
- `packages/connectors/src/oauth.ts` — `GOOGLE_SCOPES` already includes
  `https://www.googleapis.com/auth/gmail.modify` (covers `drafts.create` AND `messages.send`). **No new
  OAuth scope, no re-consent.**
- `packages/email/src/manifest.ts` / `tools.ts` / `repository.ts` — email is read-only today
  (`email.listVisibleMessages`); `email.send-on-behalf` is a `coming-soon` source-behavior. Cache
  (`app.email_messages`, migration `0012`) stores `sender`, `recipients[]`, `subject`, `external_id`
  (Gmail message id), `threadId` (in `external_metadata`).
- `packages/module-sdk/src/index.ts` — `JarvisActionPermissionTier = "ask_each_time" | "trusted_auto" | "always_confirm"`;
  family declares `defaultTier` + `allowedTiers`.
- `packages/tasks/src/settings/index.tsx` + `packages/ai/src/action-policy-routes.ts` — the settings
  pattern (`@jarv1s/settings-ui` `Switch` backed by a module REST endpoint) and the generic action-policy
  route surface.

## 0. Why this spec exists (supersedes the epic)

Epic #214 ("Proactive action loop and agency hardening") is ~70% obsolete: its slice-1 per-module
**boolean** was replaced in-tree by the richer **action-family + tier** model, slice-2 calendar already
shipped narrow write tools, and only **email agency** remains genuinely un-built. Per the epic's own
rule ("do not implement from the epic directly; split into child specs"), #214 is closed as superseded
and this spec defines the one remaining live slice as a narrow child of it.

god owns the landing mechanics: on spec-ready, god closes #214 (pointer to a new child `task` issue),
runs the 2× model-diverse spec-merge gate, and the **build is a separate Ben go-decision**.

## 1. Decision

Build **email reply agency**: Jarvis can compose a reply to an **already-cached email thread** and surface
it as a structured, confirmable **action-request card** (reusing the existing confirmation bridge). Two
tools:

- **`email.draftReply`** — `risk:"write"`, family-governed (promotable to auto). On approval it writes a
  real **Gmail draft** (`drafts.create`) threaded into the original thread; the user finishes/sends it in
  Gmail.
- **`email.sendReply`** — `risk:"destructive"`, **always confirm** (hard floor). On approval it sends via
  Gmail `messages.send`.

Scope is **replies to cached threads only** — no brand-new compose to arbitrary recipients (separate,
bigger slice). This realizes the epic's "external communication stays conservative, draft-first" stance as
code, and exercises the destructive floor on the one action that truly leaves the user's outbox.

## 2. Proposal UX

When Jarvis wants to reply, it calls `email.draftReply` or `email.sendReply`. The gateway routes through
the existing confirm-and-run bridge and renders an **action-request card** in the chat stream:

- The card shows a **structured preview** (recipient, subject, full body) — see §4.
- **Approve** → the tool executes synchronously (draft saved to Gmail, or reply sent) and reports the real
  result ("Draft saved to Gmail" / "Sent ✓" / a secret-free failure message).
- **Deny** → rejected; the conversation continues.
- **Edit is out of scope this slice.** Editing = **deny + re-ask** ("make it shorter / add X"); Jarvis
  recomposes and emits a fresh card. Because `sendReply` is destructive/always-confirm, the user reviews
  the full body on every send regardless.

A user who promotes the **`email_drafts` family to `trusted_auto`** (§3) no longer sees a card for
`email.draftReply` — Jarvis silently saves the Gmail draft and reports it. **`email.sendReply` always shows
a card**, no matter the tier.

## 3. Action family + tiers

| Tool               | risk          | actionFamilyId | executionPolicy | defaultTier     | allowedTiers                       | Card?                          |
| ------------------ | ------------- | -------------- | --------------- | --------------- | ---------------------------------- | ------------------------------ |
| `email.draftReply` | `write`       | `email_drafts` | `auto`          | `ask_each_time` | `["ask_each_time","trusted_auto"]` | Yes unless promoted to auto    |
| `email.sendReply`  | `destructive` | — (n/a)        | — (n/a)         | — (always asks) | — (n/a)                            | **Always** (destructive floor) |

- **`email_drafts`** is the promotable family: default **OFF** (`ask_each_time`), user can flip to
  `trusted_auto` ("draft replies without asking"). A Gmail draft is fully reversible and never reaches a
  recipient, so auto-drafting is the low-stakes action the trust tier exists to streamline.
- **`email.sendReply`** carries no promotable family. `resolvePolicy` returns `confirm` for any
  `risk:"destructive"` tool unconditionally — the floor **is** the always-confirm guarantee. (It may
  surface in settings as a display-only "always asks" row.)
- Default OFF for the promotable family honors "private by default" / explicit opt-in. Admin cannot set it
  for a user (admin = config power only).

## 4. Body review without violating metadata-only persistence

The user must read the full composed email to approve it, but `app.ai_assistant_action_requests` is
**metadata-only**. This resolves cleanly because the persisted row already stores only
`summarizeAssistantToolInput(input)` = `{inputKeys, inputKeyCount}` (key NAMES, never values). So **the
body is never persisted** — the invariant holds automatically.

The body reaches the card via a **structured, non-persisted preview** added to the streamed
`action_request` chunk only:

- Extend the emitted chunk with an optional `preview?: { to: string; subject: string; body: string }`
  (or a generic `previewFields`) — **stream-only, never written to the DB row**.
- The email card renders it properly (recipient chip, subject, scrollable body).
- This is a small, reusable gateway + card change; calendar/task cards may adopt it later. (Alternative
  rejected: cramming the whole email into the single `summary` string — unreviewable for a multi-line
  body.)

**Invariant:** preview rides the authenticated chat stream (same trust boundary as chat itself, which
already carries private content); the persisted action-request row and any audit entry stay key-names-only.

## 5. Recipient is server-derived (security floor)

The model supplies only **which thread** (a Jarvis cache uuid) + the composed **body**. The handler looks
up `app.email_messages` under the actor's `DataContextDb` and derives:

- **recipient** = the cached `sender` (reply-to-sender only this slice; reply-all deferred),
- **subject** = cached `subject`, `Re: ` prefixed if absent,
- **threadId** = cached `threadId` (passed to Gmail so the reply threads server-side).

**The LLM can never supply or redirect the recipient address.** A compromised/confused model cannot exfiltrate
to an arbitrary address — it can only reply into an existing, owner-visible thread. This is the security
justification for "replies-to-cached-threads only" and is a **code invariant**, not configuration.

## 6. Execution path (synchronous, mirrors calendar)

New `packages/email/src/email-write-service.ts` (modeled on `calendar-write-service.ts`), fulfilled via a
new `requiresServices: ["emailWrite"]` capability:

- `email.draftReply` → Gmail `users.drafts.create` (raw RFC822 MIME, base64url, `threadId` set).
- `email.sendReply` → Gmail `users.messages.send` (same MIME, `threadId` set).

Both run **synchronously inside the tool handler after approval** and return a real result to chat. This
mirrors the proven calendar write path and **sidesteps the metadata-only job-payload rule entirely** — no
body ever touches a pg-boss payload (a worker job would require staging the body in a new table; rejected).

Failure handling mirrors `ProposeFocusResult.message`: the handler returns a **human-facing, secret-free**
result on no-connection / missing-scope / revoked-token / Gmail API error; it never throws a raw provider
error into chat and never leaks tokens.

## 7. Settings surface

The `email_drafts` tier toggle lives in email's **existing** contributed settings surface
(`packages/email/src/settings/index.tsx`), mirroring `packages/tasks/src/settings/index.tsx`: a
`@jarv1s/settings-ui` `Switch` ("Let Jarvis draft email replies without asking") backed by a module REST
endpoint that reads/writes the `email_drafts` family tier (reuse the generic action-policy route surface in
`packages/ai/src/action-policy-routes.ts` if it accepts an arbitrary family id; otherwise add a thin
`/api/email/agency-draft-tier` endpoint matching the tasks pattern). `email.sendReply` may show as a
display-only "always asks" row.

**No first-run prompt.** Email has zero prior write behavior, so nothing changes for existing users (unlike
the tasks slice, which flipped auto→confirm). New capability ⇒ no behavior-change notice.

## 8. Acceptance criteria

- [ ] `email.draftReply` (write, family `email_drafts`, `executionPolicy:"auto"`) and `email.sendReply`
      (destructive) exist as email assistant tools, replies-to-cached-threads only.
- [ ] Proposing a reply surfaces an action-request card with a **structured preview** (to / subject / full
      body); the body is **never** persisted in the action-request row or audit log.
- [ ] Approving `email.draftReply` creates a real Gmail draft threaded into the original thread; approving
      `email.sendReply` sends via Gmail; both report a real, secret-free result.
- [ ] With `email_drafts` promoted to `trusted_auto`, `email.draftReply` executes without a card; with it
      `ask_each_time`, it confirms.
- [ ] `email.sendReply` **always** confirms regardless of any tier setting (destructive floor, `policy.ts`
      unchanged).
- [ ] Recipient/subject/threadId are derived server-side from the cached thread; the tool input carries only
      a cache message id + body. The model cannot send to an arbitrary address.
- [ ] A "draft replies without asking" toggle exists in email's contributed settings surface, backed by the
      `email_drafts` family tier; default OFF.
- [ ] Send/draft failures (no connection, missing scope, API error) return a human-facing, secret-free
      message; no raw provider error or token reaches chat/logs.
- [ ] Gateway, manifest, write-service, and settings changes ship with unit + integration coverage; the
      `foundation.test.ts` migration assertion stays green (no new migration expected — see §9).

## 9. Rollout / blast radius

- `packages/email/src/manifest.ts` — declare `email_drafts` action family + `email.draftReply` /
  `email.sendReply` tools + `requiresServices:["emailWrite"]`; promote `email.send-on-behalf` source-behavior
  from `coming-soon`.
- `packages/email/src/email-write-service.ts` (new) — Gmail draft/send via the connector (mirror
  `calendar-write-service.ts`); MIME builder; secret-free result messages.
- `packages/email/src/tools.ts` — `email.draftReply` / `email.sendReply` executes + `summarize` + the
  structured `preview` producer.
- `packages/ai/src/gateway/gateway.ts` + the `action_request` chunk contract (`packages/shared`) — add the
  optional **non-persisted** `preview` field; persistence stays key-names-only.
- Chat UI — render the structured email preview card (recipient chip / subject / scrollable body).
- `packages/email/src/settings/index.tsx` (+ REST route, shared contract) — the `email_drafts` tier toggle.
- Gateway service registry / composition host — fulfill `emailWrite` from the connector (mirror how
  `calendarWrite` is provided).
- **No DB migration / no new owned table.** Tier stored in `app.preferences` via the action-policy model;
  email writes go straight to Gmail. (If a thin email tier REST endpoint is added, it reads/writes prefs —
  still no migration.)

## 10. Security & invariants

- **Destructive floor is structural.** `risk:"destructive" → confirm` is hardcoded; no setting overrides it.
  `email.sendReply` can never auto-execute. Drafts (write) are promotable; sends are not.
- **Recipient is server-derived** from owner-visible cache (§5) — the model cannot address arbitrary
  recipients. Reply-to-sender only; reply-all deferred.
- **Metadata-only persistence holds** (§4): body rides the stream, never the DB row or audit log.
- **No new context fields.** `AccessContext` stays `{ actorUserId, requestId }`; the tier lookup is a
  gateway dep constructed per-actor (as today).
- **Secrets never escape.** Gmail tokens stay in the connector; handler results are secret-free.
- **No metadata-only-payload violation.** Synchronous execution means no email body ever enters a pg-boss
  payload.
- **RLS unchanged.** Email cache is owner-or-share; the write service reads under the actor's
  `DataContextDb`; no `BYPASSRLS`.

## 11. Out of scope (follow-up child issues)

- New-compose to arbitrary recipients (contact picker, recipient validation).
- Reply-all.
- Edit-before-approve return-channel in the confirm bridge (reusable across all modules).
- Attachments, HTML-rich composition, signatures.
- Briefing/evening-review feedback → email proposals (separate epic).
- A central agency dashboard / audit view (the existing audit log already records executions).
