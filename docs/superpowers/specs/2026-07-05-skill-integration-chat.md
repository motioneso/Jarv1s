# Skill integration for Jarvis chat (#760)

**Status:** Proposed — awaiting Ben's approval
**Date:** 2026-07-05
**Tier:** `security-sensitive` — this introduces the first user-authored content that is deliberately
fed back to the model as instructions (not just data the model reads). That is a new trust boundary
distinct from anything currently in chat; see Guardrails.
**Builds on:** epic #22 (chat CLI-bridge + MCP gateway, shipped) — this spec reuses its permission
model but does not assume it already supports what #760 asks for. See "What already exists" below.

## Problem

Issue #760 asks for four things at once: (1) a per-user skill library the user can add `skill.md`
files to, (2) create/manage/import of skills, (3) slash-command autocomplete for invoking a skill in
chat, and (4) a per-skill on/off toggle. None of this exists today. This spec scopes what "skill
integration" should mean in Jarvis's architecture before any of it is built, because the literal
request is large enough to hide several materially different (and materially different-risk)
designs behind one sentence.

## What already exists (grounding, not assumption)

Investigated `packages/chat`, `packages/ai/src/gateway/gateway.ts`, `packages/module-sdk`, and the
notification-preferences precedent (#735) before scoping this:

- **Tool calling today is code-defined, not data-defined.** Every assistant tool is a TypeScript
  function registered in a module's manifest (`assistantTools` in e.g. `packages/chat/src/manifest.ts`,
  `packages/notes/src/manifest.ts`). `AssistantToolGateway.executableTools()`
  (`packages/ai/src/gateway/gateway.ts`) resolves the live tool list per actor from active modules —
  there is no path today for a user-authored file to register a new callable tool. "Skills" as
  arbitrary new tool capability would be a different, much larger feature than what a `skill.md`
  markdown file can express.
- **The model's system prompt is a per-user rendered file, not a template engine.** `renderPersona`
  (`packages/chat/src/live/persona.ts`) writes a persona string into the CLI's context file
  (`CLAUDE.md`/`AGENTS.md`/`GEMINI.md` depending on provider) in a neutral per-user directory outside
  the repo. It already sanitizes one untrusted input (`sanitizeUserName`) specifically because
  anything written into that file becomes instructions the model treats as ground truth (#136). Any
  skill content injected into a prompt inherits this same risk and must go through equivalent
  sanitization — it cannot be treated as inert text just because it's markdown.
- **No slash-command parsing exists anywhere in the repo today** (verified via repo-wide search).
  Autocomplete-on-`/` is pure net-new chat-input UI plus a lookup, not an extension of something
  half-built.
- **The MCP gateway already has a real allowlist + confirm-gate model to reuse for risk, not
  reinvent:** tool risk tiers (`read` / `write` / `destructive`), a session-scoped `allowedToolNames`
  set, an approve/deny action-request flow with audit logging, and `resolveActiveModules` gating
  which tools are even listed per actor. Any skill-triggered tool use should ride this exact chokepoint
  — never a parallel code path.
- **Per-user on/off toggles already have a precedent to follow, not invent:** #735 (module
  notification preferences) established the shape — a small generic per-user preference API keyed by
  an id (there, `moduleId`), gating whether a capability fires, persisted and reloaded on settings
  screens. A per-skill enabled/disabled flag should follow this same shape (per-user, per-`skillId`
  boolean row), not a new preference mechanism.
- **User-authored markdown content already has a storage precedent:** Notes are ingested from a
  synced vault folder via `VaultContext` (`packages/vault`), never raw `fs`. If skills are meant to be
  edited outside the app and synced in (mirroring "add skill.md files to a library" literally), vault
  storage is the natural fit. If skills are meant to be authored/pasted inside the app UI, a normal
  owner-scoped DB table (mirroring e.g. `packages/notifications` preference rows) is simpler and needs
  no filesystem sync job. This spec does not pick one — see Open Questions.
- **`skill.md` (frontmatter + markdown body) does map naturally onto Claude Code's own skill format**,
  which is a reasonable starting shape for the file (name, description, trigger conditions, body
  instructions). But nothing in the runtime today executes a Claude Code skill — adopting the file
  *shape* is not the same as adopting Claude Code's skill *runtime* (which can shell out, read/write
  disk, invoke sub-tools). Confusing the two is the single biggest risk in this issue; see Guardrails.

## Scope (of this spec, not the build)

This spec's job is to narrow #760 into a buildable, approved slice. Candidate in-scope items for a
first slice, pending Ben's answers to Open Questions:

- A skill entity: id, owner user, title, description, body (markdown instructions), enabled flag,
  source (`authored` | `imported`), timestamps.
- A settings surface ("Skill library") to list, create, edit, enable/disable, and delete skills —
  same family as other per-user library-style settings panes.
- A slash-command autocomplete affordance in the chat input: typing `/` opens a filtered list of the
  user's *enabled* skills by name; selecting one inserts/executes it.
- A defined invocation semantic for what "running" a skill means at the model layer (see Open
  Questions — this is the crux of the whole feature and must be decided before build, not improvised
  during it).
- Reuse of the existing per-user preference precedent (#735-style) for the enabled/disabled flag —
  no new toggle mechanism.
- Reuse of the existing MCP gateway confirm/audit chokepoint for anything a skill causes the model to
  do that isn't pure text (i.e., skills never get a private side channel to tools).

## Non-goals / Guardrails

- **No provider/model hardcoding.** A skill's body is prompt content, not a provider-specific script.
  Nothing in this feature may special-case "if provider is Anthropic, do X" — the router still owns
  model selection (hard invariant: provider-agnostic AI).
- **Skills are not a new tool-execution channel.** A skill must not be able to register a new callable
  tool, bypass `AssistantToolGateway`'s risk tiers, or grant itself write/destructive capability that
  the user's existing module grants don't already cover. If a skill's instructions cause the model to
  call an existing tool, that call still goes through the normal confirm/audit path — no exceptions
  carved out for "the user wrote this skill themselves."
- **Secrets never escape.** User-authored skill content is untrusted input the moment it can
  influence what the model says or does next (same class of risk as the persona `sanitizeUserName`
  fix for #136, but with a much larger attack surface — a whole file body instead of one name field).
  A skill must never be able to cause the model to echo connector credentials, auth tokens, session
  tokens, or other secrets into its own output, into a tool call argument, or into another user's
  visible data. This needs an explicit design (sanitization, injection framing, or both) before build
  — flagged as an open question, not assumed solved by "it's just markdown."
- **No module bypass.** Do not let skill content directly query another module's tables or invoke
  internals — any effect on other modules must go through their declared public tool/route surface,
  same as everything else (hard invariant: module isolation).
- **Metadata-only job payloads still apply** if any part of import/sync becomes a background job
  (e.g. a vault-folder skill sync mirroring notes ingest) — payload carries IDs/kind only, never the
  skill body itself.
- **Do not build a marketplace, sharing, or skill-distribution mechanism in this slice.** #760 asks
  for personal create/import/manage/toggle only. Multi-user skill sharing (if ever wanted) is a
  separate milestone with its own spec and RLS shareability classification.
- **Do not silently adopt the Claude Code skill runtime's capabilities** (arbitrary script execution,
  filesystem access, sub-agent spawning). If any future slice wants richer skills than "prompt
  instructions applied to the current turn," that is new scope requiring its own spec and threat
  model, not a quiet extension of this one.

## Open questions (must be resolved before this can move from Proposed to Approved)

This issue is unusually open-ended; the following are genuine forks, not details to improvise mid-build:

1. **What does "running" a skill actually do to the model call?** Candidates, in increasing order of
   power and risk:
   - (a) Insert the skill body as a one-turn instruction prefix on the next message only (safest,
     closest to a canned prompt/macro).
   - (b) Append the skill into the persona/system-prompt file for the rest of the session (breaks
     prompt-cache byte-stability per `DEVELOPMENT_STANDARDS.md`'s Prompt-Cache Discipline section
     unless carefully scoped — the persona file is supposed to be byte-stable per user).
   - (c) Grant the skill's declared tool names as a temporary allowlist addition for that turn.
   This spec cannot proceed to Approved without Ben picking one; (a) is the recommended default given
   the guardrails above, but that is a recommendation, not a decision made here.
2. **Is `skills` its own module or does it live inside `packages/chat`?** It has its own entity,
   settings surface, and (likely) DB table — that argues for a dedicated module (`packages/skills`)
   per the module-isolation invariant, with chat consuming it only through a declared interface. Needs
   Ben's confirmation before scaffolding.
3. **Storage: vault-backed files or a DB table?** "Add skill.md files to a library" reads literally as
   file import (vault, like notes), but "create/manage" reads more like an in-app authoring UI backed
   by a normal table (like other settings entities). These have very different build costs (vault
   implies a sync job + file-watch infra; a table is a single migration + CRUD routes). Needs a
   decision, not both built speculatively.
4. **What is "import"?** Paste raw markdown, upload a `.md` file, or pull from a URL/repo? File upload
   introduces a new upload surface if one doesn't already exist for user content; URL import
   introduces an SSRF-shaped surface (the codebase already has one open finding on `web.read`
   SSRF-adjacent risk per project history — a skill importer must not reopen that class of issue).
5. **Autocomplete scope: chat only, or every text input that could reasonably invoke a skill?** #760
   says "within Jarvis chat" — confirm this is chat-input-only and not, e.g., the evening-interview
   flow or other assistant surfaces that also run model turns.
6. **Frontmatter schema for `skill.md`:** if the file format borrows Claude Code's skill shape (name,
   description, trigger keywords), does Jarvis define its own minimal schema now, or explicitly defer
   compatibility with any external skill format? Needs an explicit "v1 fields" list, not an implicit
   copy of an external spec that may change out from under it.
7. **Conflict/collision handling:** two skills with the same slash-command name, or a skill name that
   collides with a future built-in command — reject at save time, or last-write-wins? Needs a rule
   before autocomplete UI can be built deterministically.
8. **Sanitization approach for skill bodies:** does this reuse/extend `sanitizePersonaName`-style
   collapsing (aggressive, so likely too lossy for a multi-paragraph skill body), or does it need a
   different technique (e.g. clearly-delimited untrusted-content framing so the model can distinguish
   "instructions from a skill" from "the platform persona") — same class of problem `passive-retrieval`
   /`answer-provenance` already solve for external content in `packages/chat/src/live/`, worth
   reviewing as prior art before inventing a new mechanism.

## Acceptance criteria for future build

(Draft — will need revision once the Open Questions above are answered; capturing the shape Ben should
expect to review, not a final bar.)

- A user can create a skill (title, description, body) in a Skill library settings surface and see it
  persisted across reload.
- A user can import an existing `skill.md`-shaped file into their library via whatever import
  mechanism is approved in Open Question 4.
- A user can toggle any skill on/off individually; a disabled skill never appears in slash-command
  autocomplete and never affects a chat turn.
- Typing `/` in the chat input surfaces a filtered, autocomplete list of the user's *enabled* skills
  only; selecting one applies the invocation semantic decided in Open Question 1.
- No skill can cause a tool call that bypasses `AssistantToolGateway`'s existing risk-tier/confirm/audit
  path — verified by a test that a write/destructive-risk tool invoked "because a skill said so" still
  produces a pending action-request row, not a silent execution.
- No skill body can cause a secret (connector credential, auth token, session token) to appear in the
  model's output or in a tool-call argument — verified by an adversarial test with a crafted skill
  body attempting exfiltration via prompt injection.
- Skill CRUD and toggle state respect ordinary per-owner RLS (owner-only unless a future sharing
  milestone changes that) — no cross-user visibility of another user's skill library.
- Adding this feature does not regress prompt-cache byte-stability for the persona file (Development
  Standards, "Prompt-Cache Discipline") — whatever invocation semantic is chosen must not make the
  per-user persona file's byte content vary turn-to-turn if it's a hit in Open Question 1's option (b).
