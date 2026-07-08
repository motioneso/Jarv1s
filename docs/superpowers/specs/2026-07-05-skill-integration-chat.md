# Skill integration for Jarvis chat (#760)

**Status:** Approved (2026-07-07, Ben)
**Date:** 2026-07-05
**Tier:** `security-sensitive` — this introduces the first user-authored content that is deliberately
fed back to the model as instructions (not just data the model reads). Ben's decision is that a skill
body is trusted instruction content for the invocation, same trust tier as persona/system-prompt
content, with the existing MCP gateway confirm/audit model as the safety boundary; see Guardrails.
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
  anything written into that file becomes instructions the model treats as ground truth (#136). A
  skill body is likewise instruction content, not inert markdown, but Ben's decision is that it is
  trusted for the invocation rather than adversarial/quarantined input.
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
  no filesystem sync job. Ben wants both in-app authoring/editing and third-party import, so this spec
  proposes: canonical owner-scoped skill records for the app UI, with file upload importing standard
  skill files into those records.
- **`skill.md` (frontmatter + markdown body) does map naturally onto Claude Code's own skill format**,
  which is a reasonable starting shape for the file (name, description, trigger conditions, body
  instructions). But nothing in the runtime today executes a Claude Code skill — adopting the file
  _shape_ is not the same as adopting Claude Code's skill _runtime_ (which can shell out, read/write
  disk, invoke sub-tools). Confusing the two is the single biggest risk in this issue; see Guardrails.

## Scope

This spec narrows #760 into a buildable slice with Ben's decisions recorded:

- A skill library inside `packages/chat`, not a new `packages/skills` module. This is chat-scoped:
  settings management and invocation both exist to support Jarvis chat, so putting it in a separate
  module would make modularity less meaningful rather than more.
- A skill entity: id, owner user, name, description, standard frontmatter fields, body (markdown
  instructions), enabled flag, source (`authored` | `uploaded`), source metadata, timestamps.
- A settings surface ("Skill library") to list, create, edit, enable/disable, and delete skills —
  same family as other per-user library-style settings panes.
- In-app authoring/editing and third-party import. The import path is file upload for `.md`/skill
  files. Watched-directory import is not part of v1 (decided 2026-07-05; see Non-goals).
- No URL import. This intentionally avoids reopening the known `web.read` SSRF-adjacent risk class.
- A slash-command autocomplete affordance in any chat input surface, including the evening-interview
  flow: typing `/` opens a filtered list of the user's _enabled_ skills by name; selecting one runs it.
- Invocation semantics matching CLI skill use: the selected skill's body is loaded as trusted
  instruction content for that invocation. Jarvis does not add special restrictions on what users can
  write or how they choose to invoke their own skills.
- **Invocation mechanism (pinned):** running a skill injects the skill body into that single turn's
  submitted text (prepended to the user's message, or an equivalent one-turn injection through the
  live engine's submit path). It must not rewrite the per-user persona file — that would break
  prompt-cache byte-stability (already an acceptance criterion). Accepted consequence: in a normal
  (non-private) chat the injected body flows into the stored user `chat_messages` row and the
  extract-facts distillation exactly like any other user text — skills are not secret content — and
  large skill bodies proportionally inflate every invocation's turn size.
- Standard skill file format, not a Jarvis-specific format: v1 adopts the Claude Code-style
  frontmatter + markdown body shape (`name`, `description`, trigger/frontmatter fields, instruction
  body). Jarvis may persist parsed fields, but the portable file remains a normal skill file.
- Reuse of the existing per-user preference precedent (#735-style) for the enabled/disabled flag —
  no new toggle mechanism.
- Reuse of the existing MCP gateway confirm/audit chokepoint for anything a skill causes the model to
  do that isn't pure text (i.e., skills never get a private side channel to tools).
- No save-time uniqueness rejection for duplicate names. If a user imports or creates two same-named
  skills, that is on the user. If runtime lookup ever needs to pick one from an ambiguous slash command,
  use a deterministic resolution order rather than blocking save; Claude Code's source/scope
  namespacing precedent is a reasonable model.

## Storage model (Fable-reviewed 2026-07-05)

Proposed default: make the chat-owned DB record the canonical app state, with importers converting
standard skill files into those records.

- In-app create/edit writes the owner-scoped chat skill record.
- File upload parses a standard skill file and creates or updates a skill record without any URL fetch.
- The original uploaded file contents should be preserved enough to round-trip ordinary
  frontmatter + markdown without inventing a Jarvis-only format.

Fable's adversarial review (2026-07-05, grounded on `origin/main@2ad2fe70`) **endorsed the
DB-canonical + file-import split**: an owner-scoped chat table matches every existing precedent, RLS
classification is plain owner-only, and the vault is already per-user
(`vaultsBaseDir/<actorUserId>`, `packages/vault/src/vault-context.ts`), so a watched skill directory
would have clean owner mapping. The review raised two findings now folded into this spec: (1)
watched-directory import is a genuine trust escalation with real reconciliation semantics — on that
basis Ben dropped it from v1 entirely (decided 2026-07-05; see Non-goals); (2) the skill-body
injection mechanism needed pinning — now specified in Scope.

## Non-goals / Guardrails

- **No provider/model hardcoding.** A skill's body is prompt content, not a provider-specific script.
  Nothing in this feature may special-case "if provider is Anthropic, do X" — the router still owns
  model selection (hard invariant: provider-agnostic AI).
- **Skills are not a new tool-execution channel.** A skill must not be able to register a new callable
  tool, bypass `AssistantToolGateway`'s risk tiers, or grant itself write/destructive capability that
  the user's existing module grants don't already cover. If a skill's instructions cause the model to
  call an existing tool, that call still goes through the normal confirm/audit path — no exceptions
  carved out for "the user wrote this skill themselves."
- **No skills-specific sanitization/quarantine layer.** A skill body is trusted instruction content for
  the invocation, same trust tier as existing persona/system-prompt content. Do not wrap it as
  adversarial content requiring special delimited framing, do not strip its instruction language, and
  do not add a skills-specific approval mode. The safety boundary is the existing per-user action
  approval setting: confirm-gated users still approve gated actions, and users in "yolo"/auto-approve
  mode have already accepted that account-wide risk tier.
- **Secrets still do not become a skill capability.** Skills inherit the existing runtime's access
  boundaries. They do not get connector credentials, auth tokens, session tokens, direct DB access, or
  a private exfiltration path. This is enforced by the same module/tool/gateway boundaries as ordinary
  chat, not by a separate skill-body sanitizer.
- **No module bypass.** Do not let skill content directly query another module's tables or invoke
  internals — any effect on other modules must go through their declared public tool/route surface,
  same as everything else (hard invariant: module isolation).
- **Metadata-only job payloads still apply** if any part of import ever becomes a background job —
  payload carries IDs/kind only, never the skill body itself.
- **No watched-directory import in v1 (decided 2026-07-05).** File upload covers the import
  requirement. A watched synced skill directory would be the product's first file→instruction
  promotion — anything that can write the folder (another synced device, the sync client, any
  process with vault write access) could silently promote a file to system-prompt-tier instructions,
  and with account-level yolo/auto-approve that means tool execution with no confirmation — and it
  drags in reconciliation semantics (overwrite/delete/rename) this slice does not need. Any future
  watched-directory feature is new scope requiring its own spec and threat model.
- **Do not build a marketplace, sharing, or skill-distribution mechanism in this slice.** #760 asks
  for personal create/import/manage/toggle only. File upload is a personal import path, not a
  distribution feature. Multi-user skill sharing (if ever wanted) is a separate milestone with its
  own spec and RLS shareability classification.
- **Do not silently adopt the Claude Code skill runtime's capabilities** (arbitrary script execution,
  filesystem access, sub-agent spawning). If any future slice wants richer skills than "prompt
  instructions applied to the current turn," that is new scope requiring its own spec and threat
  model, not a quiet extension of this one.

## Remaining implementation details

Ben's product/security decisions are recorded above. These are implementation details to settle
during build planning, not unresolved product forks:

1. **Exact persistence shape.** Decide the concrete table/columns and whether enabled state is a
   column on the skill record or a separate #735-style preference row keyed by `skillId`.
2. **Ambiguous command resolution order.** No uniqueness validation is required. The build still needs
   a deterministic UI/runtime ordering for duplicate names (for example: exact selected record id from
   autocomplete wins; typed bare-name fallback sorts by enabled first, source/scope, then updated time).

## Acceptance criteria for future build

- A user can create a skill (title, description, body) in a Skill library settings surface and see it
  persisted across reload.
- A user can edit an existing skill in-app and keep the standard frontmatter + markdown body shape
  intact.
- A user can import an existing standard skill file via file upload. No URL import exists, and no
  watched-directory import path exists — file upload is the only file import path in v1.
- A user can toggle any skill on/off individually; a disabled skill never appears in slash-command
  autocomplete and never affects a chat turn.
- Typing `/` in any chat input surface, including evening interview, surfaces a filtered autocomplete
  list of the user's _enabled_ skills; selecting one runs that specific skill.
- Running a skill loads its body as trusted instruction content for that invocation, like using a skill
  from the CLI. Jarvis does not add a special skill-body sanitizer, quarantine wrapper, or
  skill-specific approval mode.
- A skill uses the standard Claude Code-style frontmatter + markdown body shape; Jarvis does not invent
  a bespoke skill file format.
- Duplicate skill names are allowed at save/import time. The UI remains deterministic by selecting a
  concrete skill record from autocomplete rather than relying on global name uniqueness.
- No skill can cause a tool call that bypasses `AssistantToolGateway`'s existing risk-tier/confirm/audit
  path — verified by a test that a write/destructive-risk tool invoked "because a skill said so" still
  produces a pending action-request row for confirm-gated users, not a silent execution.
- If the user has account-level "yolo"/auto-approve mode enabled, skill-triggered tool calls inherit
  that already-accepted risk posture exactly like ordinary chat-triggered tool calls.
- Skill CRUD and toggle state respect ordinary per-owner RLS (owner-only unless a future sharing
  milestone changes that) — no cross-user visibility of another user's skill library.
- Adding this feature does not regress prompt-cache byte-stability for the persona file (Development
  Standards, "Prompt-Cache Discipline"). Running a skill injects its body into that turn only, per
  the invocation mechanism in Scope — never by rewriting the per-user persona file turn-to-turn.
- ~~The storage design receives Fable's critical second-opinion review before build approval.~~
  Satisfied: reviewed 2026-07-05, endorsed — see "Storage model (Fable-reviewed 2026-07-05)"; both
  review findings are resolved in this spec.
