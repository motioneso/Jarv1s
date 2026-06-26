# Agency action-loop: confirmed proposals + per-module trust (#214, slice-1 + framework)

**Status:** approved
**Date:** 2026-06-25
**Owner:** Ben + Codex
**Grounded on:** `~/Jarv1s/packages/ai/src/gateway/policy.ts` (`resolvePolicy` — read=run, destructive=confirm,
write=confirm unless `executionPolicy:"auto"`), `packages/ai/src/gateway/gateway.ts` (confirm-and-run +
action-request bridge), `app.ai_assistant_action_requests` (confirmation cards + `/resolve`), tasks
manifest (`tasks.create`/`update`/`updateStatus` all `risk:"write"`, `executionPolicy:"auto"` — already
auto-run), `packages/tasks/src/manifest.ts`, `packages/calendar/src` & `packages/email/src` (NO assistant
write tools exist — built in slices 2/3).

Un-deferred from epic #214: all gating tickets (#31 web research, #34 task agency, #123 gateway
confirmation lifecycle, #250 quiet hours) are closed; live dogfooding shows repeated moments where
Jarvis should propose follow-up actions.

## 1. Decision

Build the **agency action loop**: when Jarvis proposes a concrete action in chat, it surfaces as a
structured, confirmable **action-request card** (reusing the existing confirmation system) rather
than prose. Each module owns a **per-module trust-tier toggle** in its own contributed settings
surface that lets the user promote that module's proposals from "confirm each time" to "auto-execute".

This spec ships **slice-1 (task proposals)** plus the **framework** (trust-tier, gateway
integration, the email-send-as-destructive invariant) and defines the **contract** for slices 2
(calendar) and 3 (email drafts) as follow-up child issues.

### Slice ordering (locked)

- **Slice-1 (this spec): task proposals.** Task write tools already exist; lowest risk; proves the loop.
- **Slice-2 (child issue): calendar proposals.** Requires building calendar write tools.
- **Slice-3 (child issue): email drafts.** Requires building email draft tool. Email _sends_ are
  `risk: "destructive"` so they always confirm regardless of trust-tier (hard invariant, §5).

## 2. The proposal UX (slice-1)

When Jarvis, in chat, wants to take a task action (create, schedule, complete), it emits a
structured proposal rendered as an **action-request card** in the chat stream, instead of plain
text. The card reuses the existing `app.ai_assistant_action_requests` + confirmation bridge:

- Card shows: the proposed action (e.g. "Create task: 'Call the dentist' in Health, due Friday"),
  the affected entity, and Approve / Deny / Edit buttons.
- **Approve** → the underlying task tool executes (`tasks.create` etc. — already `executionPolicy:
"auto"`, so on approval it runs immediately via the existing confirm-and-run path).
- **Deny** → the proposal is rejected; the conversation continues.
- **Edit** (slice-1 optional, recommended) → the user tweaks fields (title, due, list) before
  approving. If cut for time, edit = deny + re-ask.

A user with the **task trust-tier enabled** (§3) never sees the card for task proposals — Jarvis
executes directly and reports the result ("Created 'Call the dentist' — due Fri"). The card only
appears when the trust-tier is off OR the action is destructive.

### How Jarvis emits a proposal

Jarvis already has `tasks.create` as a tool. Today calling it auto-executes (no card). The change:
the **proposal** is a distinct emission. Two implementation options, decide in build:

- **(a) Tool-call-as-proposal:** when the model calls `tasks.create` and the trust-tier is OFF, the
  gateway intercepts the auto-execute and routes through the confirm bridge (rendering a card) —
  i.e. the trust-tier effectively toggles these write tools between `auto` and `confirm`. This is
  the cleanest reuse: no new tool, the existing `tasks.create` call becomes a proposal when
  trust-tier is off. Recommended.
- **(b) Separate `tasks.propose` tool:** the model calls a proposal tool that creates an
  action-request without executing; approval triggers the real tool. More moving parts; avoids any
  auto-execute ambiguity. More explicit but heavier.

**Decision: (a).** The trust-tier toggle governs whether a module's `executionPolicy:"auto"` write
tools actually auto-run (trust on) or route through the confirm bridge (trust off). This is a single
mechanism — the gateway policy resolver — that applies uniformly to tasks/calendar/email later.

## 3. Per-module trust-tier

Each module that contributes confirmable actions owns a **trust-tier toggle** in its **own
contributed settings surface** (reusing the Module Settings Connector from #474):

| Module             | Preference key                 | Toggle label                                         | Governs                                           |
| ------------------ | ------------------------------ | ---------------------------------------------------- | ------------------------------------------------- |
| tasks              | `tasks.agency_auto_execute`    | "Let Jarvis create and update tasks without asking"  | `tasks.create/update/updateStatus/...`            |
| calendar (slice-2) | `calendar.agency_auto_execute` | "Let Jarvis schedule and move events without asking" | future calendar write tools                       |
| email (slice-3)    | `email.agency_auto_execute`    | "Let Jarvis draft emails without asking"             | future `email.draft` tool (NOT `email.send` — §5) |

Default: **OFF** for every module (explicit opt-in per the "private by default" posture; Jarvis asks
until promoted). The toggle is a contributed settings surface component owned by each module.

New modules expose their own trust the same way: declare a write tool, ship a settings surface with
a `<moduleId>.agency_auto_execute` toggle. No central registry needed — the convention is the key.

## 4. Gateway integration

`packages/ai/src/gateway/policy.ts` `resolvePolicy` becomes async and reads the per-module trust
preference:

```ts
export async function resolvePolicy(
  tool: ModuleAssistantToolManifest,
  moduleId: string,
  prefs: AgencyPrefLookup
): Promise<PolicyDecision> {
  if (tool.risk === "read") return "run";
  if (tool.risk === "destructive") return "confirm"; // hard floor — never overridden
  // write tool: auto-run if the module declared auto AND the user hasn't... OR the user promoted it
  const userPromoted = await prefs.get(`${moduleId}.agency_auto_execute`);
  if (userPromoted) return "run";
  return tool.executionPolicy === "auto" ? "run" : "confirm";
}
```

**Critical subtlety:** today tasks are `executionPolicy:"auto"` and run without asking. With this
change, a module with an `auto` declaration _plus_ a trust-tier toggle means: **auto runs only when
the user has promoted it.** If the toggle is off, even an `auto`-declared write tool confirms.

This is a behavior change for tasks (they currently auto-run; after this they'll confirm until
promoted). That's intended — it's the whole point of the trust-tier — but it's a flag: existing
task-create-from-chat flows will start showing confirmation cards until the user enables the task
trust-tier. **Mitigation:** on first run after this ships, surface a one-time prompt in chat the
first time a task proposal would have auto-run: _"Jarvis now asks before creating tasks. Enable
'create without asking' in Task settings?"_ — so the change is explained, not silently annoying.

`AgencyPrefLookup` is injected by the composition host (which already constructs the gateway deps),
backed by `PreferencesRepository.get` under a per-actor `DataContextDb`. No new context field; the
actor comes from the existing gateway call context.

## 5. Email-send-as-destructive invariant (hard floor)

The email slice (slice-3) introduces `email.draft` (`risk: "write"`, governed by
`email.agency_auto_execute`) and **`email.send` declared `risk: "destructive"`**. Per `policy.ts:11`,
destructive tools **always confirm** — no setting overrides this. So even with the email trust-tier
fully enabled, sending an email always requires an explicit Approve on an action-request card.

This makes "external communication can never be fully autonomous" a **code invariant**, not a
configuration. It satisfies the issue's "keep external communication conservative, draft-first"
structurally. Any future module whose actions are externally-visible-and-hard-to-undo (messages,
posts, payments) should similarly declare those tools `destructive`.

## 6. Contract for slice-2 (calendar) and slice-3 (email)

These are follow-up child issues, each its own spec. The contract this spec locks:

- **Slice-2 calendar:** build calendar write tools (`calendar.create`, `calendar.move`,
  `calendar.reschedule`) as `risk:"write"`. Ship a contributed calendar settings surface with the
  `calendar.agency_auto_execute` toggle. Proposals flow through the same gateway path — no gateway
  changes beyond what slice-1 ships. Calendar writes hit the user's real Google calendar via the
  existing connector, so the trust-tier default-OFF is especially important.
- **Slice-3 email:** build `email.draft` (`risk:"write"`, trust-governed) and `email.send`
  (`risk:"destructive"`, always-confirm). Ship a contributed email settings surface with the
  `email.agency_auto_execute` toggle governing drafts only. The destructive-send floor (§5) means
  no email ever leaves the user's outbox without an Approve click.

Both reuse: the gateway integration from slice-1, the contributed-settings connector from #474, and
the action-request card UX. Neither requires new confirmation machinery.

## 7. Acceptance criteria (slice-1)

- [ ] When Jarvis proposes a task action in chat, it surfaces as a structured action-request card
      (Approve/Deny/Edit), not prose, **unless** the task trust-tier is enabled.
- [ ] Approving executes the underlying task tool; the result reflects in Today/Tasks immediately.
- [ ] A "Let Jarvis create and update tasks without asking" toggle exists in the **task module's
      contributed settings surface** (not core web), backed by `tasks.agency_auto_execute`.
- [ ] With the toggle ON, task proposals execute without a card; Jarvis reports the result.
- [ ] With the toggle OFF, even `executionPolicy:"auto"` task tools route through confirmation.
- [ ] Destructive tools (existing `notes.delete`, future `email.send`) always confirm regardless of
      any trust-tier setting (hard floor in `policy.ts` unchanged).
- [ ] First-run prompt explains the change to existing users whose task-create flows now confirm.
- [ ] `resolvePolicy` is async and reads the per-module pref via an injected lookup; no new
      `AccessContext`/`ToolContext` fields.

## 8. Security & invariants

- **Destructive floor is structural.** `risk:"destructive" → confirm` is hardcoded in `policy.ts`
  and not overridden by any setting. External-communication sends are destructive by declaration.
- **Trust-tier is opt-in, per-module, owner-scoped.** Stored in `app.preferences` (owner-scoped
  RLS). Default OFF. No admin can set it for a user (admin = config power only, CLAUDE.md).
- **No new context fields.** `AccessContext` stays `{ actorUserId, requestId }`. The pref lookup is
  injected as a gateway dep, constructed per-actor from the existing context.
- **Metadata-only action requests.** The existing action-request persistence stores metadata-only
  summaries (no private content), unchanged.
- **Edit-before-approve** (if shipped) must not persist anything until approved — same as today's
  confirmation flow.

## 9. Rollout / blast radius (slice-1)

- `packages/ai/src/gateway/policy.ts` — `resolvePolicy` async, reads per-module pref; destructive
  floor unchanged.
- `packages/ai/src/gateway/gateway.ts` — pass `moduleId` + `AgencyPrefLookup` to `resolvePolicy`.
- Composition host (gateway deps builder) — construct + inject `AgencyPrefLookup` from
  `PreferencesRepository` under the per-actor `DataContextDb`.
- `packages/tasks/src/settings/index.tsx` — new contributed settings surface with the trust-tier
  toggle (depends on #474 settings-connector).
- `packages/tasks/src/manifest.ts` — declare the settings surface (`entry: "./settings"`).
- Chat UI — action-request card rendering for task proposals (the existing action-request card,
  extended if needed for Edit; verify the existing card handles task-shaped proposals).
- First-run prompt wiring (one-time, in chat, the first time a task proposal would have auto-run).

No DB migration (uses `app.preferences`). No new permissions (task tools' existing `tasks.create`
etc. gate the execution on approval).

## 10. Out of scope

- Calendar write tools + calendar proposals (slice-2, child issue).
- Email draft/send tools + email proposals (slice-3, child issue).
- Briefing feedback → proposal flow (requires building briefing feedback capture first; separate epic).
- Today-page proactive suggestions (separate; may reuse the proposal card).
- A central/global agency dashboard or audit view of auto-executed actions (the existing audit log
  already records tool executions).
- Per-proposal "always allow this kind" granular rules (the per-module toggle is the unit).
