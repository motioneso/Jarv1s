# Spec revision 1 — default-allow settings writer (epic #1262)

Revise `docs/superpowers/specs/2026-07-27-settings-default-allow-writer.md` **in place**. Keep its
structure, status line, and everything not listed below. Re-verify any path you cite. Commit by
explicit path. **Spec only — no code, no PR.**

Your v1 was accepted. Seven changes: three are Ben's rulings, three come from external research, one
is a scope-presentation fix. Where a change contradicts your "Open decisions: None" line, update
that section honestly rather than defending v1.

---

## A. Ben's rulings (these override the spec — do not re-argue them)

### A1. Modules are writable. Your deny category 3 was too broad.

You denied "module installation/enablement/removal" wholesale under self-operation authority. Ben's
ruling, verbatim (2026-07-27):

> "If I am chatting with Jarvis and find out there is a sports module, I want him to turn that on
> and he should be able to. […] Any one of those that we build, the admin should be able to tell
> Jarvis, hey, download it, install this. Disabling a module, the admin should be able to do that as
> well. But enabling an already downloaded module, one that's already available for the instance, a
> user should be able to do that."

The "unreviewed third-party code" premise behind the v1 deny is **false**, and the spec should say
so. Verified on this branch:

- `packages/settings/src/routes-module-registry.ts` is a complete admin surface — list against a
  module **index**, download, remove, purge, cancel-purge. Header comment documents the pipeline.
- The download pipeline validates manifests and rejects bad ones (`manifest-invalid` → 422,
  `extract-failed` → 422, `index-unavailable` → 503). The **curated index is the trust boundary**,
  not the tool call.
- `packages/settings/src/routes-modules.ts:110-125` — instance disable is already admin-gated
  (`assertAdminUser` before any branch) and writes `setInstanceModuleDisabled`.
- `routes-modules.ts:64` — `supportsUserDisable(m)` returns `m.availability?.supportsUserDisable
  !== false`, i.e. per-user enable/disable is allowed unless a manifest opts out.
  `packages/sports/src/manifest.ts:42-46` declares `defaultEnabled: true, required: false,
  supportsUserDisable: true`.

Specify these declarations:

| Action | Scope | Classification | Authorization |
| --- | --- | --- | --- |
| Download/install a module from the index | instance | `writable` | live admin check |
| Disable / re-enable a module instance-wide | instance | `writable` | live admin check |
| Enable/disable an available module for oneself | user | `writable` | actor from `ToolContext`; requires `supportsUserDisable` |
| **Remove / purge a module** | instance | **not a generic setting write** | see below |

**The remove/purge carve-out.** Purge destroys the module's data and is not reversible by making the
opposite change — it fails your own §"Classification and guardrails" test for what belongs in the
generic writer. Keep it out of `settings.set` and route it to a separate, narrowly named
`confirm_always` tool, exactly as that section already prescribes. Ben ruled on *disable*, not
*remove*; this does not contradict him. State the distinction explicitly so a later reader does not
collapse the two.

What stays denied in category 3: YOLO flags, action-family tiers, self-operation grants, and
permissions. Module operation moves out. Rewrite the category so it covers **authority over what
Jarvis may do**, not **which features exist**.

### A2. Terminology — "external module" is wrong

Ben: *"I don't like the term external module because it makes it sound like it's not part of Jarvis.
It is. It's just not a default module. […] I think it's just a module. Like a Jarvis module, rather
than a third party."*

In the spec's **prose and any user-facing text**, say "module" — never "external module". Where you
must distinguish origin, say "a module bundled in the image" vs "a module downloaded to this
instance".

**Do not rename code, routes, types, or tables in this spec.** The existing identifiers
(`external_module*`, `/api/admin/external-modules/*`) stay as-is; the rename is tracked separately
as **issue #1312** and is explicitly out of scope for #1262. Add one line noting the dependency so
nobody "helpfully" renames things mid-build.

### A3. State the migration scope up front

Ben asked what made the scope large and confirmed the answer once it was explained. Your §"Registry
is the source of truth" buries the most consequential sentence in the spec — that every existing
settings REST route and UI mutation must be migrated to the registry-owned `apply` function.

Move this into §Outcome as an explicit scope statement, in plain language: this reroutes **every**
settings write, including a user clicking a toggle in the settings UI, not just the assistant path,
because that is the only thing that makes "unclassified fails the build" a real guarantee rather
than a convention. Say plainly that this is the bulk of the work and it touches every settings pane.

---

## B. External research (surveyed 2026-07-27)

Add a short §"Prior art" section. Keep it to what changes the design — this is not a literature
review. Then make the three changes below.

Findings worth citing:

- **Home Assistant** ([expose docs](https://www.home-assistant.io/voice_control/voice_remote_expose_devices/),
  [best practices](https://www.home-assistant.io/voice_control/best_practices/),
  [LLM API](https://developers.home-assistant.io/docs/core/llm/)) — entities are opt-in-only so voice
  cannot open locks/garage doors, and their LLM API performs **no administrative tasks**. That is the
  enumerate-to-allow model Ben rejected; note we diverge deliberately, and that their reasoning is
  driven by irreversible physical consequences that mostly do not apply to a theme or timezone.
  They resolve names with aliases at entity/area/floor level — independent convergence on §"Name and
  value resolution".
- **VS Code `contributes.configuration`**
  ([contribution points](https://code.visualstudio.com/api/references/contribution-points)) — the
  closest prior art to our registry: per-setting JSON schema with `enum`, `enumDescriptions`, and
  `enumItemLabels` (their display-name-vs-stored-value split is exactly Forest/`light`), plus
  `deprecationMessage`.
- **MCP tool annotations**
  ([spec blog](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/),
  [risk vocabulary](https://stacklok.com/blog/tool-annotations-are-becoming-the-risk-vocabulary-for-agentic-systems-that-matters-more-than-it-might-seem/))
  — `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`, pessimistic defaults
  (unannotated ⇒ assumed destructive). Same instinct as our classification but it degrades to
  caution where ours fails the build — say so, it is a real strength worth recording. The spec is
  explicit that annotations are **hints, not guarantees**, which corroborates our rule that the
  generated schema is guidance and execution re-checks the registry.
- **Cursor** ([LLM safety and controls](https://cursor.com/docs/enterprise/llm-safety-and-controls))
  — command allowlist documented as **best-effort, not a security boundary**, because injection can
  route around it. Same reason enforcement cannot live in the tool schema.
- **OpenClaw** ([docs](https://docs.openclaw.ai/start/openclaw)) and **Hermes Agent**
  ([docs](https://hermes-agent.nousresearch.com/docs/user-guide/skills/bundled/autonomous-ai-agents/autonomous-ai-agents-hermes-agent))
  — the two closest self-hosted assistants. Neither lets the assistant configure the app; safety is
  perimeter-based (channel `allowFrom`, sandboxed terminal backends, approval interception before
  every tool call). Note plainly that a classified registry over an app's own settings is **not**
  established practice in this category, so our safety argument has to stand on its own rather than
  on convention.

### B1. Bound the tool schema — context saturation is a documented failure mode

Home Assistant reports that with 300+ exposed entities the model dumps the entity list instead of
answering, and their guidance is to expose the minimum. A generated discriminated `oneOf` over every
writable declaration walks into the same wall as the registry grows, and v1 does not address it.

Specify the mitigation and justify the choice. A two-step shape — a discovery/list call, then
`settings.set` with a resolved id — is the obvious candidate but not the only one; if you keep the
single generated schema, you must state a concrete size bound, what happens when it is exceeded, and
how that is measured. **Add a verification criterion that fails when the schema grows past the
stated bound**, so this cannot rot silently.

### B2. Flag runtime choice resolution as the risky part

Your §"Name and value resolution" requires module-owned **runtime** choice resolvers so a user's
custom themes resolve by name alongside the six built-ins. VS Code has never shipped the equivalent
— dynamic enum values remain an open request
([microsoft/vscode#187141](https://github.com/microsoft/vscode/issues/187141)) after years, because a
generated schema and a runtime-varying value set are in tension.

Keep the requirement — custom themes are exactly the case that motivated this epic — but stop
treating it as a footnote. Say how a runtime resolver coexists with a generated static schema
(candidates: resolver output stays out of the schema and is validated only at execution; or the
schema carries built-ins and the resolver handles the open set), what the failure mode is when the
two disagree, and how resolution latency and failures are handled on the write path. **A resolver
that does network I/O on a write path must fail closed.**

### B3. Add a deprecation path

The registry makes settings feel permanent, and v1 has no answer for retiring one. VS Code uses
`deprecationMessage` / `markdownDeprecationMessage` to warn and hide a setting while still honouring
existing values.

Specify what happens when a setting is removed or replaced: what the declaration looks like while
deprecated, whether it stays in the generated schema, what the model is told when a user asks for it
by an old name, and what happens to stored values and pending undo records that reference it.

### B4. Name the classifications MCP-compatibly

Live MCP proposals would add `reads-private-data` / `sees-untrusted-content` / `can-exfiltrate` to
let a client detect the "lethal trifecta" in one session. Do not adopt them now — but where our
classification maps cleanly onto existing MCP annotation vocabulary, note the correspondence in one
short paragraph so a future MCP surface can project our registry without a rename. This is a naming
note, not a new mechanism.

---

## C. Unchanged constraints

Hard invariants in `CLAUDE.md` still apply — no admin private-data bypass, private by default,
`DataContextDb` only, `AccessContext` is `{actorUserId, requestId}` only, secrets never escape,
metadata-only job payloads, provider-agnostic AI, module isolation, never edit applied migrations
(`0175`/`0176`/`0177` FROZEN). Everything in v1's §"What survives from the superseded spec" stands.

Ben's governing ruling is unchanged: **guardrails, not permission prompts.** The remove/purge carve-
out is the single narrow exception and must be justified as such.

Update §"Open decisions" honestly. If these changes surface a genuine product fork, say so and mark
it for Ben rather than settling it yourself.
