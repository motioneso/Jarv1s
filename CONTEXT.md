# Jarv1s Domain Context

Shared domain language for Jarv1s. Jarv1s is a private, single-user-per-actor
assistant whose product north-star is to **excel for people with executive-function
challenges** — making task capture, prioritization, and "what do I do next" low-effort
and low-overwhelm.

## Language

> **Project** is deliberately _not_ a domain term. A "project" is just whatever the
> user chooses to name a List or a Tag — there is no separate Project concept.

### Tasks & obligations

**Task**:
A thing that needs to get done. The single surface the user acts on day-to-day.
A Task may be entered manually (the common case) or created on the user's behalf by
Jarv1s from another source (a meeting action item, a chat exchange, or a recurring
chore). Designed so its origin is always traceable.
_Avoid_: To-do, item, action (use Task)

**Commitment**:
Not a separate record, surface, field, or module — a Commitment is simply a **Task whose
Source is inferred**: Jarv1s detected, from a meeting or chat, that the user is on the
hook for something (e.g. "send Sarah the documents"). Any counterparty context ("Sarah's
waiting") lives in the Task's **description**, not a dedicated field. Drift applies to it
exactly as to any Task. The chief-of-staff rule: the user sees one unified Task list,
never "your tasks, and separately your commitments."
_Avoid_: Promise, obligation (use Commitment). _Note_: a legacy `app.commitments` table
ships in `structured-state` but is **not** part of this model; retiring it is a separate
future cleanup.

**Subtask**:
A Task that is a step of a larger parent Task. Same thing as a Task — "subtask" only
names its position in a hierarchy. Breaking a big Task ("clean the kitchen") into
ordered Subtasks is a core executive-function affordance.
_Avoid_: Step, child item (use Subtask)

**Recurring task**:
A Task set to repeat on a fixed schedule. Exactly one live instance exists at a time;
the next is generated when the current is completed or its occurrence passes, and missed
occurrences roll forward without stacking.
_Avoid_: Repeating task (use Recurring task)

**Chore**:
A scheduled, repeating responsibility owned by a _separate_ future Chores area that
automates Task creation. From the Tasks domain's point of view a Chore is simply another
**Source** of Tasks — Tasks hold no chore-specific logic.
_Avoid_: Recurring task (a Chore is managed elsewhere and creates Tasks; the two differ)

**Drift**:
How far a Task/Commitment has slipped from being on-track for its due date, judged from
progress on its steps. Surfaced as escalating signal (on-track → at risk → slipped) so
Jarv1s can nudge _before_ something is late.
_Avoid_: Lateness, slippage (use Drift; "slipped" is one Drift state)

**Activity**:
A Task's append-only stream that doubles as its _living status_ and work-notes — system
events (created, broken-down, completed), the user's freeform progress notes ("bought
new tires, arriving tomorrow"), and — in a _later_ milestone — a **conversation with
Jarv1s**: the user @-mentions Jarv1s in a Task's Activity and Jarv1s replies inline. Each
entry records who acted (user / Jarv1s / system). An empty stream means nothing has
happened yet; the briefing must read it before describing a Task.
_Avoid_: Comments, audit log, history (use Activity)

### Organization

**List**:
The single home of a Task — a broad, user-named life area (Personal, Work, "Rebuilding
the car", …). Every Task belongs to exactly one List; new Tasks default to "Personal".
User-managed (create/rename/delete), no cap. This is the same idea as the legacy
free-text `life_area` on commitments/entities, promoted to a managed thing for Tasks.
_Avoid_: Folder, area, category, project (use List)

**Tag**:
A user-defined label that lives _within a List_ (e.g. "Visa", "Aligned Energy" under
Work). A Task may carry many Tags, but only Tags belonging to its own List.
_Avoid_: Label, project (use Tag)

### Provenance

**Source**:
How a Task came to exist — an open namespaced string set _automatically_ by whatever
created it (`manual`, `chat`, `commitment`, `chore`, `meeting:zoom`…). Never
user-entered. `manual` means the user typed it; any other value means Jarv1s created it
on the user's behalf. The friendly "added by you / added by Jarv1s" label is _derived_
from Source (no separate "created by" field).
_Avoid_: Origin, channel, created-by (use Source)

**Source ref**:
The id of the originating record a Task came from (the meeting, chore, or commitment).
Empty for manual Tasks. Lets Jarv1s deep-link back to _why_ a Task exists. Paired with an
internal idempotency key so an automated Source can never create the same Task twice.
_Avoid_: Origin id, parent ref (use Source ref)

### Time & priority

> **Capture-minimal principle:** only a title (and List, which defaults) is ever
> required. Priority, due date, do date, effort, tags, description are all optional —
> forcing a form is the executive-function anti-pattern this product exists to avoid.

**Priority**:
One of five named levels, stored 1–5: **Someday (1) · Low (2) · Medium (3) ·
High (4) · Critical (5)**. A deliberately small set — no 0–100 scale.
_Avoid_: Importance score, rank, P1/P2 (use the named levels)

**Due date**:
The hard deadline a Task is actually due by. Drives the _urgency_ axis of the Matrix.
_Avoid_: Deadline (use Due date)

**Do date**:
Optional — the date the user _intends to work on_ a Task, distinct from its Due date
(e.g. due next week but I want to do it today). A core EF affordance.
_Avoid_: Scheduled date, start date (use Do date)

**Effort**:
Optional rough size of a Task: **quick / medium / large**. Enables "knock out the
quick wins" and "what fits in 30 minutes".
_Avoid_: Estimate, points, spiciness (use Effort)

**Matrix**:
The derived Eisenhower view of Tasks — **Do** (important + urgent) · **Schedule**
(important, not urgent) · **Delegate** (urgent, not important) · **Eliminate** (neither).
Computed from Priority × Due-date proximity; never stored. Jarv1s is active on **Do**,
lightly on **Schedule**. The Matrix is an _alternative_ view: the **default view is a
single list grouped by Priority**, and the user may opt to make the Matrix their default.
_Avoid_: Quadrants, Eisenhower box (use Matrix)

### Assistant & tools

**Jarvis**:
The assistant the user converses with in the chat drawer. Provider-agnostic — it is
whichever CLI/model the user has configured, given a persona. Acts on the user's behalf
only through gated assistant tools, never raw host access.
_Avoid_: bot, agent (when you mean the product-facing assistant), AI.

**Module**:
A self-contained feature unit (tasks, calendar, email, vault, …) that connects to the
core through the module SDK and never modifies core code. A module can be enabled or
disabled; a disabled module contributes nothing — no routes, no tools, no behavior.
_Avoid_: plugin, package (a module may span packages), service.

**Assistant tool**:
A discrete capability a module exposes for Jarvis to invoke on the user's behalf. Owned
end-to-end by the module — the module both declares it and executes it (its `execute`
handler). Classified by Risk. Read/lookup needs are met by specific bounded tools, never
by raw host shell access.
_Avoid_: function, command (an "action request" is a distinct concept).

**Risk** (`read` | `write` | `destructive`):
Classification of an assistant tool by the consequence of invoking it. `read` changes
nothing; `write` creates or updates; `destructive` deletes or is otherwise irreversible.
Drives whether a call runs directly, needs confirmation, or always needs confirmation.
_Avoid_: permission level, danger.

**Action request**:
A `write` or `destructive` assistant-tool call that Jarvis has proposed, intercepted and
held before execution, pending the user's **Approve** or **Deny** in the drawer. Approve
runs it; Deny returns a "denied by user" result the agent is expected to handle normally.
A denial is an expected outcome, not an error.
_Avoid_: confirmation prompt, approval (reserve Approve/Deny for the user's choice).

**Gateway** (Jarv1s MCP gateway):
The single chokepoint between Jarvis and every module's real operations. Lists tools,
validates input, enforces Risk-based policy and the confirmation bridge, scopes each call
to the user under RLS, and dispatches to the owning module's handler. Jarvis's _only_
capability — there is no path to act that bypasses it.
_Avoid_: MCP server (use Gateway for the enforcement role; "MCP server" is the transport).

### Connectors & external accounts

**Connector**:
A built-in integration to a category of external service (Google Calendar, Gmail). The
provider-level definition — what _can_ be connected — independent of any one user.
_Avoid_: integration, plugin (use Connector).

**Connection** (a.k.a. connector account):
One user's authorized, credentialed link to a Connector — their own encrypted tokens, theirs
alone. Owner-only: a user's Connection is never visible to another, and the instance admin
connecting Google does not connect anyone else. A Connection has a status (active / error /
revoked); `error` means its credential needs re-authorizing.
_Avoid_: account, login (use Connection; "connector account" is the table name).

**Auth method**:
How a Connection authenticates. For Google it is **per-user OAuth**: each user creates their
_own_ Google Cloud "Desktop app" client and authorizes read+write scopes, so no shared
instance app and no Google verification is involved. (Riding the LLM CLI's vendor connectors,
and a shared instance app, were considered and rejected — see ADR 0006.)
_Avoid_: integration type, login method (use Auth method).

**Guided connection**:
The skill-driven walkthrough that helps a user stand up their OAuth client and authorize a
Connection — delivered from the **Settings** page or by **Jarvis** in the chat drawer. The
same walkthrough, two surfaces.
_Avoid_: onboarding wizard, setup flow (use Guided connection).
