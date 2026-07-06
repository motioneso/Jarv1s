# Feature Gap Analysis — Jarvis vs. Comparable AI Assistant / Agent Platforms

**Date:** 2026-07-05
**Grounded on:** working tree `52138c8c` (main, 2026-07-05)
**Scope:** Deep multi-source research across 5 tool families (10+ products) to identify features Jarvis should consider adopting. Equal weight across four lenses: **(A)** development enablement, **(B)** agent autonomy, **(C)** knowledge / RAG, **(D)** UX / integration.
**Method:** Six parallel research agents hit primary docs/repos for each tool family; a seventh mapped Jarvis's current capabilities from the codebase. This document synthesizes all seven into a single decision-ready report.

> **Revision 2 — reconciliation update (2026-07-05, later the same day).** The original draft was grounded on `main` only and did not see the 2026-07-04/05 spec wave on the active coordination branch, nor epic #798. This revision reconciles against that work and fixes two citations. Summary of changes:
>
> - `origin/main` has since moved to `1fc4f3e9` (PR #816, module data-lifecycle ports Phase A — part of epic #798). The capability map below still describes `52138c8c` accurately.
> - **Recommendation #5 (citations)** partially shipped: issue #539 (source-backed answers with provenance, spec `2026-06-28-source-backed-answers-provenance.md`) is CLOSED. The remainder (adjacent-chunk expansion, retrieval contract, modes) is tracked as issue #822.
> - **Recommendation #11's prompt-only skill tier** is already spec'd: issue #760 / `2026-07-05-skill-integration-chat.md`. The code-skill tier folds into the open-module-system epic.
> - **Recommendation #13 (automations → digest)** is already spec'd for the notifications slice: issue #742 / `2026-07-05-email-digest-delivery.md`.
> - **Lens A's "closed, first-party-only" framing** understated in-flight work: epic #798 (module docking seams) is actively building the first-party half of the module-SDK substrate, and deferred epic #216 is the ecosystem umbrella. Recommendation #1 is now framed as an extension of #798, not greenfield.
> - **Tracking issues created** for the reconciled recommendations: epics **#818** (open module system) and **#819** (workflow layer on pg-boss); features **#820** (Custom AI Commands), **#821** (MCP client + server), **#822** (RAG retrieval upgrades), **#823** (`@`-mention tool scoping), **#824** (GOAP scratch_pad), **#825** (harness abstraction), **#826** (palette power-ups). All labeled `needs-spec` per the spec-before-build gate.
> - Citation fixes: the gateway lives at `packages/ai/src/gateway/gateway.ts` (not `packages/ai/src/gateway.ts`); the README alpha statement is line 5, not 4.

> **How to read this report.** Section 1 is the exec summary and the only required reading. Sections 2–5 are the four lens analyses (each ends with a feature table). Section 6 is the consolidated gap matrix. Section 7 is the prioritized roadmap proposal. Section 8 is the per-feature invariant-impact analysis (required reading before speccing any of these). Sections 9–10 are the per-tool deep-dive appendices with full citations.
>
> Paths in this report use `~/Jarv1s/...` per repo convention; file:line citations are relative to the repo root.

---

## 1. Executive summary

Jarvis today is a **self-hosted, single-user-per-actor personal AI assistant** built on unusually strong foundations: Postgres **RLS on every table including admins**, a **provider-agnostic capability router** (`packages/ai/src/capability-route-map.ts:5`) plus a **CLI-driven chat runtime** that drives `claude`/`codex`/`gemini` through tmux/Herdr or an RPC sidecar (`packages/chat/src/live/runtime.ts:82`), a single **MCP gateway** that every mutating model action flows through with **risk-tiered confirmation** (`packages/ai/src/gateway/gateway.ts:118`), an **AES-256-GCM vault** for secrets, **pg-boss** for jobs, a **memory graph** with entities/facts/episodes (`packages/memory/src/manifest.ts:92`), **vault notes + semantic search**, real (not stubbed) **Gmail + Calendar** via a Google connector, **briefings** and **proactive monitoring** on cron, and a hand-authored design system. The product is explicitly alpha (`README.md:5`).

Against that baseline, the ten external tools studied fall into three buckets:

| Bucket                                   | Tools                                              | Headline takeaway for Jarvis                                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Code-execution / computer-use agents** | Open Interpreter (Rust + Python), OpenHands, Cline | Jarvis already has the safest version of what these do (the confirmation gateway). Steal the **harness abstraction**, the **two-axis sandbox + permission profiles**, and the **`createTool` SDK contract**.                                                                                                            |
| **Open-weight tool-use models**          | Hermes 2/3/4 (Nous)                                | Jarvis's router is the hook. Steal **Hermes function-calling format support**, the **GOAP `<scratch_pad>` agent frame**, **prompt-based JSON-schema mode with self-heal retry**, and **RefusalBench** as an eval gate.                                                                                                  |
| **Desktop launchers / browser AI**       | Raycast, Arc Max / Dia                             | The **Custom AI Command**, the **command/tool/action taxonomy**, **AI Extensions (`@`-mention + per-tool instructions + ask-before-run)**, and **MCP client support** all map cleanly onto Jarvis's existing palette shell + chat module.                                                                               |
| **Workflow / automation builders**       | n8n, Windmill, Activepieces                        | Jarvis's pg-boss is the right substrate; what's missing is the **workflow-graph semantics** and the **dev-enablement SDK**. Steal **declarative piece SDK with auto-rendered auth**, the **LangChain-style Agent+Tool+Memory decomposition**, **bidirectional git sync**, and **AI sandboxes with persistent volumes**. |
| **Private RAG assistants**               | AnythingLLM, PrivateGPT, Khoj                      | Jarvis's RLS is _stronger_ than these tools' tenancy models. Steal the **plugin manifest + handler** skill authoring surface, **score-threshold + Query/Chat/Agent modes**, **citations + adjacent-chunk expansion**, and **proactive automations → digest delivery**.                                                  |

### The five highest-leverage recommendations (full rationale in §7)

1. **Open the module system to third-party / user-authored modules** with a declarative SDK (skill manifest + typed handler + auto-rendered auth + `requestToolApproval` gate). Runtime loading of non-first-party modules doesn't exist today — but epic #798 (module docking seams) is actively building the first-party half of this substrate, so spec this as #798's extension, not greenfield. Still the single biggest unlock; hits three of four lenses at once. _(Dev-enablement + Agent autonomy + UX.)_ → **epic #818**
2. **Add a workflow layer on top of pg-boss** — graph semantics (branching, per-step retries, suspend/approval, crash recovery) + a thin visual builder + an AI workflow builder that demonstrably excludes secrets from the LLM. _(Dev-enablement + Agent autonomy.)_ → **epic #819**
3. **Custom AI Commands as a first-class, user-authorable object** (prompt template + model + creativity + output behavior + typed dynamic placeholders), RLS-scoped, shareable at household level. _(UX + Dev-enablement.)_ → **issue #820**
4. **MCP client support** — let users plug external MCP servers into Jarvis's chat (each becomes an `@`-mention tool, OAuth tokens in the vault, ask-before-run default). One module unlocks N tool surfaces. _(Integration + Dev-enablement.)_ → **issue #821**
5. **Strengthen the RAG primitive + add retrieval modes** — adjacent-chunk expansion, `metadata_filter` + `collection` retrieval contract, and Query/Chat/Agent modes with a per-scope similarity floor. Citations-as-first-class already shipped via issue #539 — build on its shape. _(Knowledge/RAG + UX.)_ → **issue #822**

A further **five recommendations** round out a ten-feature roadmap (§7).

---

## 2. Lens A — Development Enablement (let users build tools on Jarvis)

This was the lens you wanted to make sure we didn't over-focus on. Across the tools studied, three distinct dev-enablement models emerge, and **Jarvis currently ships none of them for non-first-party authors**. It is not greenfield, though: epic #798 (module docking seams — dataset connector SDK #800, web module registry #799, data-lifecycle ports #801, boundary enforcement) is actively building the _first-party_ drop-in module DX, and deferred epic #216 is the ecosystem umbrella. What's genuinely missing is the layer above #798: a loading/discovery mechanism, sandboxing, and a stable SDK contract for modules not compiled into the repo.

### 2.1 The three dev-enablement models in the wild

**(a) Schema-first / SDK-first** (Cline, Activepieces, n8n). A developer writes a TypeScript object: name, description, JSON-Schema input, `execute()` function. The platform renders the UI from the schema, surfaces it to the model as a function-calling tool, and handles auth + sandboxing. Cline's `createTool` ([github.com/cline/cline](https://github.com/cline/cline)) is the cleanest example:

```ts
const deployTool = createTool({
  name: "deploy",
  description: "Deploy current branch to staging.",
  inputSchema: { type: "object", properties: { env: { type: "string" } }, required: ["env"] },
  execute: async (input) => {
    /* ... */
  }
});
```

Activepieces adds **declarative auth** (`PieceAuth.SecretText({...})`, `PieceAuth.OAuth2({...})`) that auto-renders the credential form, and a **7-second hot-reload** loop during local piece dev ([activepieces.com/docs/build-pieces](https://www.activepieces.com/docs/build-pieces/building-pieces/piece-definition.md)). n8n's declarative node SDK does the same for workflow nodes ([docs.n8n.io](https://docs.n8n.io/integrations/builtin/node-types.md)).

**(b) Manifest + handler / plugin folder** (AnythingLLM). A skill is a folder under `STORAGE_DIR/plugins/agent-skills/<hubId>/` containing `plugin.json` (manifest with `setup_args` → auto-UI, `examples` → few-shot prompts, `entrypoint` with typed params) and `handler.js` exporting a runtime function. The handler receives `this.runtimeArgs` (decrypted config), `this.introspect(msg)` (stream a thought), `this.logger`, and crucially **`this.requestToolApproval({description, payload})`** — a human-in-the-loop gate that returns `{approved, message}` and auto-rejects after 120s in non-interactive contexts ([docs.anythingllm.com/agent/custom/handler-js](https://docs.anythingllm.com/agent/custom/handler-js)). Skills **hot-load** mid-session without restarting AnythingLLM.

**(c) Code-as-runtime-object** (legacy Open Interpreter Python). The `interpreter.computer` object is a Python object the LLM calls _inside generated code_ (not via function-calling JSON). Extension = swap or add to `interpreter.computer.languages` with a 5-method class (`name`, `run`, `stop`, `terminate`, `system_message`). State persists in-process across turns ([docs.openinterpreter.com/code-execution/custom-languages.md](https://docs.openinterpreter.com/code-execution/custom-languages.md)). This is the most flexible but least safe; Jarvis's private-by-default stance rules it out as the _primary_ model.

### 2.2 What Jarvis should adopt

Jarvis's `module-registry` + manifest contracts _already_ look like model (a) internally — every module statically registers tools with the gateway. The gap is that **there is no loading/discovery mechanism for anything not first-party**. The right move is a hybrid of (a) and (b):

- **Module-as-package**: a Jarvis module is a TypeScript package exporting a manifest (name, version, tools, auth requirements, permissions). Loaded from a registry dir (local) or npm install.
- **Declarative auth** maps directly onto the **AES-256-GCM vault**: the module declares the secret _shape_, the vault stores the _value_, the loader injects decrypted creds at call time. Never in code, never in a pg-boss payload.
- **`requestToolApproval` becomes a pg-boss job**: the proposed action is parked as a pending `ai_assistant_action_request` (the table already exists — `packages/ai/sql/0016_ai_assistant_actions.sql`), the metadata-only payload is `{skill_id, call_id, proposed_action_hash}`, and the Approve/Deny card UX Jarvis already ships surfaces it.
- **Hot-reload in dev mode**: a `JARVIS_DEV=1` path that re-imports a module on file save (Activepieces's 7-second loop is the benchmark).

This is **recommendation #1** in §7 and the single biggest unlock in the report. Tracked as **epic #818**, explicitly sequenced after the #798 seams land.

### 2.3 Two adjacent dev-enablement features worth bundling

- **Bidirectional git sync** (Windmill's strongest feature — [docs.windmill.dev/advanced/git_sync](https://docs.windmill.dev/docs/advanced/git_sync)). User-authored modules/workflows export to a git repo as serializable TS/JSON, with per-user forks and PRs. The non-negotiable rule: only _definitions_ round-trip; vault references, run data, and credentials never leave the instance (Windmill's `--skip-variables --skip-secrets --skip-resources` flags are the template).
- **AI workflow builder that excludes secrets from the LLM** (n8n — [docs.n8n.io/build/ways-of-building-workflows/ai-workflow-builder.md](https://docs.n8n.io/build/ways-of-building-workflows/ai-workflow-builder.md)). "Describe the tool you want" → emit a module/workflow definition. The builder LLM sees module schemas and capability descriptions only; never vault contents or user data. Jarvis's router can even route the builder's own LLM calls to a local model for maximal privacy. This turns dev-enablement into _user_-enablement.

### 2.4 Lens-A feature table

| Feature                                                                       | Source                           | Jarvis fit                                                   | Priority |
| ----------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------ | -------- |
| Open module system (declarative SDK + auto-auth + approval gate + hot-reload) | Activepieces, AnythingLLM, Cline | Module-registry exists; add loader + SDK + vault-backed auth | **P0**   |
| Workflow layer on pg-boss (graph semantics, retries, suspend/approval)        | n8n, Windmill, Activepieces      | pg-boss exists; layer semantics on top                       | **P0**   |
| AI workflow/module builder (secrets-excluded)                                 | n8n                              | Router + module-registry are the substrate                   | **P1**   |
| Bidirectional git sync (definitions only)                                     | Windmill                         | pg-boss metadata serializes cleanly                          | **P1**   |
| 7-second hot-reload dev loop                                                  | Activepieces                     | Dev-mode module re-import                                    | **P2**   |
| AI sandboxes with persistent volumes                                          | Windmill                         | Needs worker/sidecar (strains single-process model)          | **P2**   |
| Code-execution module type (sandboxed)                                        | Open Interpreter, Windmill       | Strains single-process; needs sidecar                        | **P3**   |

---

## 3. Lens B — Agent Autonomy

Jarvis today is **autonomous within a single turn** (the LLM CLI can call tools repeatedly until it answers) and **not autonomous across turns** (no background goal-pursuit, no long-horizon planning engine). The closest things to background autonomy are the cron-driven briefings and proactive-monitor scans — which are jobs, not agents. The CLI's own loop is the only agent loop, by design.

### 3.1 What the comparison set teaches

**n8n's LangChain-style cluster-node model** is the most composable agent surface found. An "AI Agent" is a root node that connects to pluggable sub-nodes: **Model**, **Memory**, **Tool**, **Output Parser** ([docs.n8n.io/.../langchain.agent](https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent.md)). The transferable idea: Jarvis already abstracts the Model slot via the router. Adding **Tool** and **Memory** as first-class, swappable abstractions would let a Jarvis agent run = (router-selected model) × (set of tool modules) × (memory adapter). The **"Call n8n Workflow Tool"** pattern maps to "any Jarvis module can be registered as a callable tool," so users compose tools from existing modules.

**Hermes's GOAP `<scratch_pad>`** is a lightweight ReAct frame (Goal / Actions / Observation / Reflection) emitted before every tool call, baked into the Hermes 3 training distribution ([github.com/NousResearch/Hermes-Function-Calling](https://github.com/NousResearch/Hermes-Function-Calling)). It's a one-prompt addition that increases tool-call accuracy and produces an auditable reasoning trace — valuable for a personal assistant where the user wants to see _why_ Jarvis acted. Model-agnostic (works on Claude/GPT/Hermes). Cheap ship, big autonomy/UX win. Optionally gate it on tasks requiring >1 tool call.

**Open Interpreter's harness abstraction** is the most novel idea in the whole survey ([openinterpreter.com/docs/terminal/harness](https://www.openinterpreter.com/docs/terminal/harness)). A harness swaps the _entire model-facing surface_ (system prompt, tool schema, message conversion, response parsing) per provider family, while keeping the native runtime. Harnesses auto-infer provider/model fingerprints. For Jarvis this means: one router, but each provider gets the _behavioral shape_ it was trained against (Anthropic Messages harness for Claude, chat-completions harness for Kimi/Qwen/DeepSeek, etc.), dramatically improving cheap-model results without changing module code. It also gives a clean place to enforce Jarvis-wide invariants (RLS-aware tool schemas, vault-declassification rules) _between_ the harness and the runtime.

**Open Interpreter's two-axis sandbox + permission profiles** is the cleanest safety factoring seen: **sandbox mode** (`read-only` / `workspace-write` / `danger-full-access`) is orthogonal to **approval policy** (`untrusted` / `on-request` / `never`), layered with **permission profiles** (per-path read/write/deny globs like `**/*.env` = `deny`, per-domain network allow/deny lists, Unix-socket rules) ([openinterpreter.com/docs/terminal/sandbox](https://www.openinterpreter.com/docs/terminal/sandbox), [/permissions](https://www.openinterpreter.com/docs/terminal/permissions)). The design rule is explicit: _"when a requested policy cannot be enforced, Open Interpreter should fail closed rather than silently running unsandboxed."_ Jarvis's module isolation + RLS give coarse isolation; this gives fine-grained, declarative, per-tool policy on top.

**OpenHands's ACP (Agent Client Protocol) bet** is worth watching: Agent Canvas doesn't call an LLM directly — it spawns any agent's CLI subprocess (Claude Code, Codex, Gemini CLI, or a custom stdio JSON-RPC server) and relays JSON-RPC over stdio ([agentclientprotocol.com](https://agentclientprotocol.com/), [docs.openhands.dev/.../acp-agents](https://docs.openhands.dev/openhands/usage/agent-canvas/acp-agents)). Stored logins (macOS Keychain, `~/.codex/auth.json`, `~/.gemini/oauth_creds.json`) auto-detect and **take priority over API keys**. This is essentially what Jarvis's CLI-driven runtime already does — but ACP generalizes it to any agent. The transfer: expose a Fastify endpoint that speaks ACP, let users plug in any coding/automation agent as an isolated subprocess, inherit existing CLI logins rather than asking for another API key. Combined with the vault, subprocess env can be populated with decrypted secrets at spawn time.

### 3.2 The "pre-inject runtime state" pattern (legacy OI)

A small but transferable idea from legacy Open Interpreter Python: the pattern of `interpreter.computer.run("python", "import replicate; replicate.api_key='...'")` _before_ `interpreter.chat(...)`, then telling the model "Replicate is already imported" ([docs.openinterpreter.com/code-execution/usage.md](https://docs.openinterpreter.com/code-execution/usage.md)). This is the cleanest answer to "how does an assistant hand credentials to an agent _without_ putting them in the prompt or in tool-call args?" For Jarvis: decrypt the needed secret in the per-session runtime, inject into the process env/REPL, tell the model the capability is "already available." Secrets never traverse LLM context, never appear in logs, die with the session.

### 3.3 Lens-B feature table

| Feature                                                                              | Source           | Jarvis fit                                             | Priority |
| ------------------------------------------------------------------------------------ | ---------------- | ------------------------------------------------------ | -------- |
| Tool + Memory as first-class swappable abstractions (Agent = Model × Tools × Memory) | n8n              | Router covers Model; add Tool/Memory slots             | **P1**   |
| GOAP `<scratch_pad>` as default agent-loop frame for multi-step tasks                | Hermes 3         | One-prompt addition, model-agnostic                    | **P1**   |
| Harness abstraction over the router (per-provider model-facing surface)              | Open Interpreter | Router normalizes requests today; harness goes further | **P1**   |
| Two-axis sandbox + permission profiles (deny-globs, net allowlist)                   | Open Interpreter | Module isolation gives coarse; add fine-grained policy | **P2**   |
| ACP endpoint (plug in any CLI agent as subprocess)                                   | OpenHands        | CLI-driven runtime already does this implicitly        | **P2**   |
| Pre-inject runtime state (vault→agent credential handoff, never in prompt)           | legacy OI        | Vault exists; add per-session runtime injection        | **P2**   |
| Long-horizon / background goal-pursuit engine                                        | (none studied)   | New surface; defer until workflows land                | **P3**   |

---

## 4. Lens C — Knowledge / RAG

Jarvis already has a real RAG story: a **memory graph** (entities, facts, episodes, aliases, conflict groups, candidates — `packages/memory/src/manifest.ts:92`) with `memory.recall` / `memory.remember` / `memory.forget` tools (`packages/memory/src/graph-tools.ts`), passive per-turn graph recall injected into chat (`packages/module-registry/src/index.ts:1046`), and **vault notes + semantic search**. This is more than most tools studied have. The gaps are in the _retrieval primitive shape_ and in _retrieval-mode UX_.

### 4.1 The retrieval primitive — adopt PrivateGPT's shape

PrivateGPT's `POST /v1/primitives/search` returns `{score, document.artifact, doc_metadata, text, previous_texts, next_texts}` with an `expand: true` flag ([docs.privategpt.dev/api-reference/primitives/search.md](https://docs.privategpt.dev/api-reference/primitives/search.md)). Two parts of this are directly transferable:

- **Citations as a first-class part of the messages API** — PrivateGPT calls this out in its capability matrix. **Reconciliation: Jarvis already shipped this** via issue #539 (source-backed answers with provenance, spec `2026-06-28-source-backed-answers-provenance.md`, CLOSED). Any further retrieval work must build on #539's citation shape rather than reinvent it.
- **Adjacent-context expansion (`previous_texts` / `next_texts`)** — chunk-neighborhood retrieval. Cheap to add (pgvector window over a chunk `order_id` column) and meaningfully improves answer grounding.

PrivateGPT also ships a clean **`context_filter`** (`collection` + `artifacts[]` + `metadata_filter` dict, intersection semantics). Jarvis should adopt the same shape: map `collection` → a knowledge-scope column guarded by RLS; `metadata_filter` → JSONB `@>` predicates on the chunks table. Keeps the RLS invariant while giving callers flexible narrowing.

### 4.2 Retrieval modes — adopt AnythingLLM's three-mode UX

AnythingLLM's three chat modes are a small feature with outsized trust payoff ([docs.anythingllm.com/features/chat-modes](https://docs.anythingllm.com/features/chat-modes)):

- **Query** — docs-only, _refuses if nothing relevant is found_. This is the "no-hallucination" mode and maps perfectly to Jarvis's private-by-default ethos.
- **Chat** — docs + general knowledge (hybrid).
- **Agent** — tool-using.

Plus a **per-workspace similarity threshold** (None / Low ≥.25 / Medium ≥.50 / High ≥.75). Jarvis should expose a `mode` enum on chat endpoints and a `similarity_floor` per knowledge scope stored alongside the pgvector index.

### 4.3 Workspace-as-tenancy — Jarvis already wins, but make it explicit

AnythingLLM's hardest invariant is _"the LLM can only see docs embedded in this workspace"_ ([docs.anythingllm.com/chatting-with-documents/rag-in-anythingllm](https://docs.anythingllm.com/chatting-with-documents/rag-in-anythingllm)). Jarvis gets this **for free and stronger** via Postgres RLS: every pgvector query runs under the requesting user's role, so cross-workspace leakage is impossible at the DB layer, not the app layer. Action: model Jarvis "knowledge scopes" on AnythingLLM workspaces but make RLS the enforcement. Document it. This is a marketing position as much as a feature.

### 4.4 Two-tier skills (prompt-only + code)

PrivateGPT's skills are **versioned, immutable-per-version, `collection`-scoped, `lazy|eager`-loaded `SKILL.md` artifacts** ([docs.privategpt.dev/api-guide/skills.md](https://docs.privategpt.dev/api-guide/skills.md)) — pure prompt instructions, no code. This is _complementary_ to AnythingLLM-style code skills. Most Jarvis users will want persona/workflow prompts (no code); power users want code. Ship two skill tiers: (a) prompt-only skills stored as versioned, RLS-scoped, AES-encrypted-at-rest rows; (b) code skills via the Lens-A SDK. Both go through the provider-agnostic router. **Reconciliation: tier (a) is already spec'd** — issue #760 / `2026-07-05-skill-integration-chat.md` covers the per-user `skill.md` library, slash-command autocomplete, and per-skill toggles. Tier (b) folds into epic #818; this report adds nothing #760 hasn't already scoped for the prompt tier.

### 4.5 Connector/sync pattern — milestone-gated

Khoj's **Obsidian/Emacs/Desktop-file-sync** plus **Notion/GitHub OAuth connectors** are the gold standard for personal-data ingestion ([docs.khoj.dev/data-sources/share_your_data](https://docs.khoj.dev/data-sources/share_your_data), [/notion_integration](https://docs.khoj.dev/data-sources/notion_integration)). **Jarvis's hard invariant forbids raw connector sync without a milestone** (`CLAUDE.md:99`). Two safe stepping stones:

- **(a) Now, no milestone:** a **manual upload + `--watch`-style local folder observer** (PrivateGPT does exactly this — `make ingest /path --watch`, [docs.privategpt.dev/api-guide/ingestion.md](https://docs.privategpt.dev/api-guide/ingestion.md)). The observer runs as a pg-boss job reading metadata-only events; bytes flow through the vault.
- **(b) Milestone-gated later:** full Notion/GitHub OAuth connectors. Follow Khoj's "Configure" = explicit re-index trigger (not silent background pull) so the user controls sync cadence. Tokens in the vault, never in pg-boss payloads.

### 4.6 Lens-C feature table

| Feature                                                     | Source                                    | Jarvis fit                                      | Priority           |
| ----------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------- | ------------------ |
| Citations + adjacent-chunk expansion in retrieval primitive | PrivateGPT                                | pgvector window over chunk order_id             | **P0**             |
| Query/Chat/Agent modes + per-scope similarity floor         | AnythingLLM                               | Expose `mode` enum on chat endpoints            | **P1**             |
| `collection` + `metadata_filter` retrieval contract         | PrivateGPT                                | JSONB `@>` on chunks table, RLS-scoped          | **P1**             |
| Two-tier skills (prompt-only versioned + code)              | PrivateGPT + AnythingLLM                  | Skill rows + Lens-A SDK                         | **P1**             |
| Manual upload + local-folder-watch observer                 | PrivateGPT                                | pg-boss job, vault bytes, metadata-only payload | **P1**             |
| Knowledge-scope-as-workspace (RLS-enforced, documented)     | AnythingLLM                               | Already true; make it explicit + documented     | **P2**             |
| Hybrid search (BM25 + vector)                               | (declared but shipping-400 in PrivateGPT) | pgvector + tsvector dual index                  | **P3**             |
| Full OAuth connector sync (Notion/GitHub/…)                 | Khoj                                      | **Milestone-gated** per CLAUDE.md:99            | **P3 / milestone** |

---

## 5. Lens D — UX / Integration

### 5.1 Custom AI Commands (the single most portable feature)

Raycast's **Custom AI Command** is the feature most directly portable to Jarvis. A named, configurable prompt with: **Name & Icon**, **Model** (per-command override), **Creativity** (none/low/medium/high/maximum), **Reasoning Effort**, **Output Behavior** (**Open in Raycast** _or_ **Replace Selection** — writes the result back in-place), **Highlight Editing Changes** (diff the rewrite), **Tags**, share-via-link, import/export as JSON, personal-or-Teams scope ([manual.raycast.com/ai/ai-commands](https://manual.raycast.com/ai/ai-commands)).

Prompts use **Dynamic Placeholders**: `{selection}`, `{argument name="Language"}`, `{clipboard}`, `{date}`, `{focusedApp}`. Example prompts verbatim from the docs: `Translate {selection} to Swedish`, `Summarize {selection} into three bullet points`, `Reply to this email in my tone: {selection}`, `@calendar what does my afternoon look like?`.

**Map to Jarvis:** new `packages/shared/src/ai-commands-api.ts` exporting `JarvisAICommand { id, title, icon, prompt, model, creativity, outputBehavior: "open-in-panel" | "replace-selection" | "append-to-note", placeholders: JarvisPlaceholder[], tags, scope: "personal" | "household" }`. Store as RLS-scoped rows. Register into the existing palette shell (`apps/web/src/shell/command-palette.tsx`). Placeholders become typed: `{selectedTask}`, `{currentNote}`, `{todayBriefing}`, `{clipboard}`, `{date}`. Hits three lenses at once: dev-enablement (users build their own), knowledge/RAG (the prompt can `{reference}` any Jarvis entity), UX (one-keystroke from the palette). This is **recommendation #3** in §7.

### 5.2 AI Extensions / `@`-mention tool-calling

Raycast's model: any extension can declare **tools**, the user `@mentions` to scope, the model picks the tool, **approval required by default**, per-tool **Custom Instructions** ([manual.raycast.com/ai/ai-extensions](https://manual.raycast.com/ai/ai-extensions)). This is the agent-autonomy layer done conservatively — exactly the right shape for a private-by-default assistant. Jarvis's existing connectors + memory-graph + tasks/calendar/notes modules each already expose a typed query/mutation surface in `packages/shared/src/*-api.ts`. Wrap those as `JarvisTool`s; the chat module gains an `@`-mention parser. Default to "confirm before tool runs" (matches Raycast's default _and_ Jarvis's existing risk-tiered gateway). Per-tool Custom Instructions become per-connector system-prompt fragments (Jarvis already has `source-behaviors-api.ts` and `persona-api.ts`).

### 5.3 MCP client support

Raycast's MCP integration: **stdio + HTTP transports**, **OAuth Dynamic/Static with PKCE**, **tokens encrypted per-server**, each server becomes an `@`-mention`, **Custom Instructions per server**, **ask-before-run default** ([manual.raycast.com/ai/model-context-protocol](https://manual.raycast.com/ai/model-context-protocol)). n8n ships both an **MCP Server Trigger** (a workflow becomes a tool discoverable by Claude/Codex) and an **MCP Client node** ([docs.n8n.io/.../mcptrigger](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcptrigger.md)).

MCP is becoming the lingua franca of agent tooling. Supporting it gives Jarvis a free ecosystem of third-party tools without authoring them. Jarvis should ship **both directions**: a Fastify route that proxies/spawns MCP servers per-user (client), and the existing MCP gateway already makes Jarvis modules callable from external agents (server). OAuth tokens use the same envelope as connector credentials (`connectors-api.ts`). This is **recommendation #4** in §7. One module unlocks N tool surfaces.

### 5.4 Command palette / hotkey UX — frecency + deeplinks + inline args

Raycast's Root Search is loved because of: **frecency ranking** (more often + more recently picked ranks higher), **aliases** (short custom keywords), **favorites** (pinned top), **inline command arguments** (up to 3, filled in the search bar), **deeplinks** (`raycast://` links for every command), and **parameterized Quicklinks** with placeholder substitution (`https://github.com/{argument name="org"}/{argument name="repo"}`, [manual.raycast.com/quicklinks](https://manual.raycast.com/quicklinks)).

Jarvis already has the palette shell (`apps/web/src/shell/command-palette.tsx`). Add frecency, inline args, and deeplinks (`jarvis://task/123`, `jarvis://note/abc`). Quicklinks become user-defined parameterized routes — a new `quicklinks-api.ts` in shared. **Snippets** (keyword-triggered text expansion) become _in-app_ templates expandable inside the Jarvis composer/notes editor — scoped by RLS, shareable across household members.

### 5.5 What does NOT translate (be honest in the roadmap)

- **Global `⌘Space` invocation / global hotkey** → needs a desktop app or browser extension.
- **Cross-application snippet expansion** → same.
- **OS-level integrations** (`@finder`, `@apple-health`, `@location`, Hyper Key, Window Management) → out of scope for web Jarvis without a companion native app.
- **Per-tab browser AI** (Arc's actual value prop) → Jarvis isn't a browser; the transferable residue is the _content-synthesis_ pattern (Dia-style Reports), not the browser chrome.

### 5.6 Transferable residue from Arc Max / Dia

Arc Max's documented features (5-Second Previews, Tidy Tab Titles, Tidy Downloads, Instant Links, Tidy Tabs, ChatGPT in Command Bar — [resources.arc.net/.../Arc-Max-Boost-Your-Browsing-with-AI](https://resources.arc.net/hc/en-us/articles/19335160678679-Arc-Max-Boost-Your-Browsing-with-AI)) are mostly browser-chrome-specific. But two patterns transfer:

- **5-Second-Preview-as-a-pattern** → for any Jarvis entity (note, task, calendar event, memory node), a hover/peek affordance that generates a one-paragraph AI summary on demand. Cheap, high-utility, RLS-scoped. Uses the existing `ai-summary-api.ts`.
- **Dia-style Reports / Morning Brief** → a user-typed prompt that fans out across modules (calendar + tasks + email + notes + memory-graph) and returns one synthesized artifact. Jarvis's module isolation makes this _easier_ than in a monolith — each module already exposes a typed query surface in `packages/shared`, so a Reports agent just needs read access across them, scoped by RLS. Jarvis already has a `briefings-api.ts` and `apps/web/src/today/`; this generalizes it.

### 5.7 Proactive automations → digest delivery (from Khoj)

Khoj **Automations** = cron'd query → email ([docs.khoj.dev/features/automations](https://docs.khoj.dev/features/automations)). This is a genuinely different interaction mode (push, not pull) and Jarvis has the perfect substrate: **pg-boss scheduled jobs with metadata-only payloads** (`automation_id`, never the rendered output). Add an `automations` table (cron, prompt, delivery channel) and a pg-boss cron that enqueues a render job; the render job runs through the RAG pipeline + provider-agnostic router and pushes the digest to the user's channel of record. No new infra — pure use of existing machinery. **Reconciliation: the notifications slice of this is already spec'd** — issue #742 / `2026-07-05-email-digest-delivery.md` (email digest of accumulated module notifications, building on #735 preferences and #733 quiet hours). What remains from this recommendation is the _generalization_: arbitrary user-authored prompt → scheduled digest, which should be specced as an extension of #742's delivery machinery (and later re-platformed onto the #819 workflow layer), not as a parallel system.

### 5.8 Lens-D feature table

| Feature                                                                  | Source       | Jarvis fit                              | Priority |
| ------------------------------------------------------------------------ | ------------ | --------------------------------------- | -------- |
| Custom AI Commands (user-authorable, RLS-scoped, shareable)              | Raycast      | Palette shell + chat module exist       | **P0**   |
| `@`-mention tool-calling (per-tool instructions, ask-before-run default) | Raycast      | Tool surfaces exist in shared/\*-api.ts | **P1**   |
| MCP client (plug external MCP servers in)                                | Raycast, n8n | Vault envelope exists for tokens        | **P1**   |
| MCP server (expose Jarvis modules to external agents)                    | n8n          | Already implicitly true; formalize      | **P2**   |
| Frecency palette + inline args + deeplinks + Quicklinks + Snippets       | Raycast      | Palette shell exists                    | **P1**   |
| 5-Second-Preview hover-summary for any entity                            | Arc Max      | Uses existing ai-summary-api.ts         | **P2**   |
| Cross-module Reports / generalized Morning Brief                         | Dia          | Module isolation is the asset           | **P2**   |
| Proactive Automations → digest delivery                                  | Khoj         | pg-boss + RAG pipeline already exist    | **P1**   |

---

## 6. Consolidated gap matrix

Rows = capabilities Jarvis could add. Columns = the four lenses. Cells = ✓ (directly serves that lens), ◐ (indirectly serves it).

**Tracking (rev 2):** #1 → epic #818 · #2 → epic #819 · #3 → issue #820 · #4 → issue #821 · #5 → issue #822 (citations portion shipped via #539) · #6 → issue #823 · #8 → issue #824 · #9 + #10 → issue #822 · #11 → prompt tier spec'd in issue #760, code tier in epic #818 · #12 → issue #826 · #13 → notifications slice spec'd in issue #742 · #14 (+#15, #16 behind the same seam) → issue #825. Rows #7 and #17–#32 intentionally have no issues yet — they depend on Wave-1 outcomes or need a milestone decision first.

| #   | Feature                                                            | Dev-enable | Autonomy | RAG | UX/Integ | Priority           |
| --- | ------------------------------------------------------------------ | ---------- | -------- | --- | -------- | ------------------ |
| 1   | Open module system (SDK + vault-auth + approval gate + hot-reload) | ✓          | ✓        | ◐   | ✓        | **P0**             |
| 2   | Workflow layer on pg-boss (graph, retries, suspend/approval)       | ✓          | ✓        |     | ◐        | **P0**             |
| 3   | Custom AI Commands (user-authorable, shareable)                    | ✓          |          | ◐   | ✓        | **P0**             |
| 4   | MCP client + formalized MCP server                                 | ✓          |          |     | ✓        | **P1**             |
| 5   | Citations + adjacent-chunk expansion in retrieval                  |            |          | ✓   | ✓        | **P0**             |
| 6   | `@`-mention tool-calling (per-tool instructions, ask-before-run)   |            | ✓        |     | ✓        | **P1**             |
| 7   | Tool + Memory as first-class swappable abstractions                | ✓          | ✓        | ◐   |          | **P1**             |
| 8   | GOAP `<scratch_pad>` agent-loop frame                              |            | ✓        |     | ✓        | **P1**             |
| 9   | Query/Chat/Agent modes + per-scope similarity floor                |            |          | ✓   | ✓        | **P1**             |
| 10  | `collection` + `metadata_filter` retrieval contract                |            |          | ✓   | ◐        | **P1**             |
| 11  | Two-tier skills (prompt-only versioned + code)                     | ✓          | ✓        | ✓   |          | **P1**             |
| 12  | Frecency palette + inline args + deeplinks + Quicklinks + Snippets |            |          |     | ✓        | **P1**             |
| 13  | Proactive Automations → digest delivery                            |            | ✓        | ◐   | ✓        | **P1**             |
| 14  | Harness abstraction over the router                                |            | ✓        |     | ◐        | **P1**             |
| 15  | Hermes function-calling format support in the router               |            | ✓        |     | ◐        | **P2**             |
| 16  | Prompt-based JSON-schema mode with self-heal retry                 |            | ✓        |     | ◐        | **P2**             |
| 17  | AI workflow/module builder (secrets-excluded)                      | ✓          |          |     | ◐        | **P1**             |
| 18  | Bidirectional git sync (definitions only)                          | ✓          |          |     | ◐        | **P1**             |
| 19  | Manual upload + local-folder-watch observer                        |            |          | ✓   | ◐        | **P1**             |
| 20  | Two-axis sandbox + permission profiles                             |            | ✓        |     | ◐        | **P2**             |
| 21  | Pre-inject runtime state (vault→agent credential handoff)          |            | ✓        |     | ✓        | **P2**             |
| 22  | ACP endpoint (plug in any CLI agent)                               | ◐          | ✓        |     | ✓        | **P2**             |
| 23  | 5-Second-Preview hover-summary for any entity                      |            |          | ◐   | ✓        | **P2**             |
| 24  | Cross-module Reports / generalized Morning Brief                   |            | ✓        | ◐   | ✓        | **P2**             |
| 25  | RefusalBench as a router-model eval gate                           |            | ✓        |     | ◐        | **P2**             |
| 26  | AI sandboxes with persistent volumes                               | ✓          | ✓        |     |          | **P2**             |
| 27  | 7-second hot-reload dev loop                                       | ✓          |          |     |          | **P2**             |
| 28  | Knowledge-scope-as-workspace (RLS-enforced, documented)            |            |          | ✓   | ✓        | **P2**             |
| 29  | Hybrid search (BM25 + vector)                                      |            |          | ✓   |          | **P3**             |
| 30  | Full OAuth connector sync (Notion/GitHub/…)                        |            |          | ✓   | ✓        | **P3 / milestone** |
| 31  | Long-horizon background goal-pursuit engine                        |            | ✓        |     | ◐        | **P3**             |
| 32  | Code-execution module type (sandboxed)                             | ✓          | ✓        |     |          | **P3**             |

---

## 7. Prioritized roadmap proposal

Grouped into four waves. Each feature's invariant-impact is in §8.

### Wave 1 — Foundation unlocks (P0, ~3-4 specs)

These unblock everything else and hit multiple lenses.

1. **Open the module system** (#1) — **epic #818**. The single biggest unlock. Without it, none of the dev-enablement features in this report can be user-authored. Spec the SDK, the vault-backed auth declaration, the `requestToolApproval`-via-pg-boss gate, and the dev-mode hot-reload. Sequenced after the epic #798 seams land; extends them rather than replacing them.
2. **Workflow layer on pg-boss** (#2) — **epic #819**. Spec the graph semantics (branching, per-step retries, suspend/approval, crash recovery) and a thin visual builder. This is the substrate for AI workflow builder, AI sandboxes, and proactive automations.
3. **Adjacent-chunk expansion + retrieval contract** (#5, reconciled) — **issue #822**. Citations shipped via #539; the remaining retrieval-primitive work is still the cheapest RAG win.
4. **Custom AI Commands** (#3) — **issue #820**. Spec `ai-commands-api.ts`, the placeholder type system, and the palette integration; reuse the chat-model-selector spec's per-conversation model machinery.

### Wave 2 — Agent surface + integration (P1, ~5-7 specs)

These turn Jarvis from a single-turn assistant into a composable agent platform.

5. **MCP client + formalized MCP server** (#4) — **issue #821**. One spec, both directions.
6. **`@`-mention tool-calling** (#6) — **issue #823**. Spec the mention parser, per-tool Custom Instructions, ask-before-run default (build on the existing risk-tiered gateway).
7. **Tool + Memory as swappable abstractions** (#7) + **GOAP `<scratch_pad>`** (#8 — **issue #824**). Bundle into one agent-loop spec.
8. **Retrieval modes + contract** (#9, #10) — bundled into **issue #822** with the Wave-1 retrieval work.
9. **Two-tier skills** (#11) — prompt tier already spec'd (**issue #760**); code tier lands under epic #818.
10. **Frecency palette + Quicklinks + Snippets** (#12) — **issue #826**.
11. **Proactive Automations → digest delivery** (#13) — notifications slice already spec'd (**issue #742**); spec the generalization as an extension of it.
12. **Harness abstraction** (#14) — **issue #825**; spec carefully, this touches the router core.
13. **AI workflow builder** (#17) + **git sync** (#18). Depends on Wave 1 #1, #2 (epics #818, #819) — issues deferred until those land.
14. **Manual upload + folder-watch** (#19).

### Wave 3 — Hardening + depth (P2, ~6-8 specs)

15. **Hermes function-calling format** (#15) + **JSON-schema mode with self-heal** (#16). Bundle into the harness spec (**issue #825**) as router extensions behind the same seam.
16. **Two-axis sandbox + permission profiles** (#20).
17. **Pre-inject runtime state** (#21).
18. **ACP endpoint** (#22).
19. **5-Second-Preview** (#23) + **Cross-module Reports** (#24). Bundle into one UX spec.
20. **RefusalBench eval gate** (#25).
21. **AI sandboxes with persistent volumes** (#26). Needs a worker/sidecar decision.
22. **Hot-reload dev loop** (#27).
23. **Knowledge-scope-as-workspace documentation** (#28).

### Wave 4 — Deferred / milestone-gated (P3)

24. **Hybrid search** (#29).
25. **Full OAuth connector sync** (#30) — explicitly milestone-gated per `CLAUDE.md:99`.
26. **Long-horizon goal-pursuit engine** (#31).
27. **Code-execution module type** (#32).

---

## 8. Invariant-impact analysis (required reading before speccing)

Per `CLAUDE.md`, the hard invariants are: **no admin private-data bypass / RLS on all actors**, **private by default**, **DataContextDb only**, **AccessContext shape (actorUserId + requestId only)**, **secrets never escape**, **metadata-only pg-boss payloads**, **provider-agnostic AI**, **spec before build**, **module isolation**, **pgvector image**, **never edit applied migrations**. Below: per-feature risk + the rule that resolves it.

### Features that respect all invariants cleanly (safe to spec)

- **#3 Custom AI Commands** — stored as RLS-scoped rows, route through the provider-agnostic router, no secrets in payloads. ✅ all.
- **#5 Citations + adjacent-chunk expansion** — same RLS policy as the chunks table; `doc_metadata` rides along in the same row. ✅ all.
- **#9 Retrieval modes + similarity floor** — `mode` enum + `similarity_floor` are query-time params; no schema change beyond a column on the knowledge-scope table. ✅ all.
- **#10 `collection` + `metadata_filter`** — `collection` is an RLS-guarded column; `metadata_filter` is JSONB `@>` on the chunks table. RLS still does the gating. ✅ all.
- **#12 Frecency palette + Quicklinks + Snippets** — pure frontend + RLS-scoped rows. ✅ all.
- **#23 5-Second-Preview** — uses existing `ai-summary-api.ts`, RLS-scoped. ✅ all.
- **#24 Cross-module Reports** — reads across modules via their declared public APIs; RLS governs each read. Module isolation respected. ✅ all.
- **#28 Knowledge-scope-as-workspace** — already true at the RLS layer; just documentation. ✅ all.

### Features that strain one invariant but have a clean resolution

- **#1 Open module system** — strains **module isolation** (third-party code inside the process). Resolution: third-party modules run in a Worker/iframe sandbox with a `postMessage` RPC allowlist (mirrors Raycast's "thin RPC that only exposes a defined set of APIs"). Strains **secrets never escape** — resolution: vault-backed auth declaration; the loader injects decrypted creds at call time, never exposed to the module's source map / logs. ✅ with those two rules.
- **#2 Workflow layer on pg-boss** — strains **metadata-only job payloads** when large artifacts move between steps. Resolution: borrow Windmill's **Shared Directory** pattern — large payloads are path references (`vault://workflow/<id>/step/<n>`), not inline blobs; the pg-boss payload carries only the path + hash. ✅ with that rule.
- **#6 `@`-mention tool-calling** — already implemented in the risk-tiered gateway; this is a UX layer. ✅ all.
- **#7 Tool + Memory abstractions** — strains **RLS** if memory (chat history) is stored in a global vector store. Resolution: memory adapter must store rows under the same owner/RLS policy as the conversation. ✅ with that rule.
- **#8 GOAP `<scratch_pad>`** — pure prompt addition; the scratchpad is part of the assistant turn, governed by the same prompt-injection defenses Jarvis already has (`<tool_result>` trust-boundary wrapping). ✅ all.
- **#11 Two-tier skills** — prompt-only skills: versioned rows, AES-encrypted-at-rest if sensitive. Code skills: depend on #1's sandbox. ✅ with #1 rules.
- **#13 Proactive Automations** — pg-boss cron with metadata-only payload (`automation_id`); the render job runs the RAG pipeline under the owner's role. ✅ all.
- **#14 Harness abstraction** — touches the router core. Strains **provider-agnostic AI** in spirit (per-provider surfaces) but actually _strengthens_ it (each provider gets its best shape). The harness is a _translation layer_, not a hardcoding. Invariant intact if the harness registry itself is provider-agnostic. ✅ with that framing.
- **#15 Hermes function-calling format** + **#16 JSON-schema mode** — router extensions; the format/grammar is selected by capability, not hardcoded to a feature. ✅ all.
- **#17 AI workflow builder** — strains **secrets never escape** if the builder LLM sees vault contents. Resolution (n8n's rule): the builder sees module schemas + capability descriptions only; never vault contents or user data. Optionally route the builder's own LLM calls to a local model. ✅ with that rule.
- **#18 Bidirectional git sync** — strains **private by default** (workflow definitions leave the instance). Resolution: only definitions round-trip; vault references, run data, and credentials never leave (Windmill's `--skip-variables --skip-secrets --skip-resources` is the template). ✅ with that rule.
- **#19 Manual upload + folder-watch** — strains **secrets never escape** only if the observer is careless. Resolution: bytes flow through the vault; pg-boss job carries metadata-only events. ✅ with that rule.
- **#21 Pre-inject runtime state** — strains **secrets never escape** in the _opposite_ direction (secret _does_ reach the runtime). Resolution: secret lives only in the per-session process env/REPL, never in the prompt, never in tool-call args, never in logs, dies with the session. This is the _point_ of the pattern. ✅ with that rule.
- **#22 ACP endpoint** — strains **secrets never escape** if subprocess env is logged. Resolution: vault populates subprocess env at spawn time; subprocess logs are scrubbed. ✅ with that rule.
- **#25 RefusalBench eval gate** — pure CI/eval addition. ✅ all.
- **#27 Hot-reload dev loop** — dev-only path (`JARVIS_DEV=1`). ✅ all.
- **#29 Hybrid search** — adds a tsvector column alongside the pgvector index; new migration file (never edit applied). ✅ all.

### Features that strain architecture and need a milestone decision

- **#20 Two-axis sandbox + permission profiles** — strains the single-process Fastify model for true OS-level sandboxing (Seatbelt/bubblewrap). Resolution options: (a) policy-only enforcement at the gateway (coarser but no new infra), or (b) a sidecar worker for sandboxed tools. Decide in the spec.
- **#26 AI sandboxes with persistent volumes** — strains the single-process model; needs a separate worker (like Activepieces's one-flow-per-worker) or a container sidecar. Strains **metadata-only payloads** for large artifacts — use Windmill's Shared Directory pattern. **Needs a milestone.**
- **#30 Full OAuth connector sync** — **explicitly milestone-gated per `CLAUDE.md:99`.** Not a strain so much as a deferred decision.
- **#31 Long-horizon goal-pursuit engine** — new surface; defer until workflows (#2) land so the engine has a substrate.
- **#32 Code-execution module type** — strains the single-process model; needs a sidecar. **Needs a milestone.**

### Features that need a new migration

Any feature adding tables/columns needs a **new** migration file in the owning module's `sql/` directory (never `infra/postgres/migrations/`, never edit an applied file). Concretely: ai-commands table, workflows table, automations table, skills table (if prompt-only skills are stored), knowledge-scope columns. Each gets its own numbered file in the owning module.

---

## 9. Appendix — Per-tool deep dives (with citations)

### 9.1 Open Interpreter / OpenHands / Cline

**Critical context: there are now two Open Interpreters.** The official project was rewritten in Rust and now forks OpenAI Codex — it's a terminal coding agent with a "harness emulation" system ([github.com/OpenInterpreter/open-interpreter](https://github.com/OpenInterpreter/open-interpreter) README). The original Python project (the famous `interpreter.computer` object, OS mode, Jupyter-style persistent REPL) lives on as a community fork at [github.com/endolith/open-interpreter](https://github.com/endolith/open-interpreter).

**Open Interpreter Rust (official):**

- **Harness abstraction** — swaps the entire model-facing surface per provider family while keeping the native runtime. Harnesses: `claude-code`, `claude-code-bare`, `kimi-cli`, `deepseek-tui`, `qwen-code`, `swe-agent`, `minimal`. Auto-infers provider/model fingerprints. ([openinterpreter.com/docs/terminal/harness](https://www.openinterpreter.com/docs/terminal/harness))
- **Skills** — `SKILL.md` (YAML frontmatter + body) + `scripts/` + `references/` + `assets/`. Locations: `.agents/skills/` (repo-local) → `~/.agents/skills/` (personal) → bundled. Skill scripts run through normal sandbox + approval controls. This convention is now shared by OpenHands, Cline, Claude Code, opencode. ([openinterpreter.com/docs/terminal/skills](https://www.openinterpreter.com/docs/terminal/skills))
- **Two-axis sandbox + permission profiles** — sandbox (`read-only` / `workspace-write` / `danger-full-access`) orthogonal to approval (`untrusted` / `on-request` / `never`), layered with permission profiles (deny-globs like `**/*.env`, network allow/deny, Unix-socket rules). Platform enforcement: macOS Seatbelt, Linux bubblewrap+seccomp, Windows native. Fail-closed. ([openinterpreter.com/docs/terminal/sandbox](https://www.openinterpreter.com/docs/terminal/sandbox), [/permissions](https://www.openinterpreter.com/docs/terminal/permissions))
- **ACP agent + MCP server** — `interpreter acp` runs as an ACP agent; `interpreter mcp-server` exposes it as an MCP server. ([/docs/terminal/acp](https://www.openinterpreter.com/docs/terminal/acp), [/docs/terminal/mcp-server](https://www.openinterpreter.com/docs/terminal/mcp-server))

**Open Interpreter Python (legacy/community):**

- **`interpreter.computer` object** — Python object the LLM calls inside generated code. In OS Mode: `display`, `keyboard`, `mouse` (OCR-based click-on-text/icon), `clipboard`, `os.get_selected_text`, Mac-specific `mail`/`sms`/`contacts`/`calendar`. ([/code-execution/computer-api.md](https://docs.openinterpreter.com/code-execution/computer-api.md))
- **Custom languages** — 5-method class (`name`, `run`, `stop`, `terminate`, `system_message`) becomes a "language." Docs show swapping local Python for E2B cloud Python in ~15 lines. ([/code-execution/custom-languages.md](https://docs.openinterpreter.com/code-execution/custom-languages.md))
- **Pre-inject runtime state** — `interpreter.computer.run("python", "import replicate; replicate.api_key='...'")` before `interpreter.chat(...)`, then `interpreter.custom_instructions = "Replicate already imported"`. ([/code-execution/usage.md](https://docs.openinterpreter.com/code-execution/usage.md))
- **LMC message protocol** — small, well-specified extension of OpenAI messages with a `computer` role and typed payloads (`console`/`output`, `image`/`base64`, `code`/`python`, `audio`/`wav`). ([/protocols/lmc-messages.md](https://docs.openinterpreter.com/protocols/lmc-messages.md))
- **Local-first** — `interpreter --local` (Llamafile), `--api_base` for any OpenAI-compatible server (LM Studio, Ollama, Jan), `interpreter.offline = True` kills telemetry/update checks. Local mode auto-shrinks context window to fit RAM. ([/guides/running-locally.md](https://docs.openinterpreter.com/guides/running-locally.md))

**OpenHands:**

- "Self-hosted developer control center for coding agents and automations." Runs built-in OpenHands agent _or_ any ACP agent (Claude Code, Codex, Gemini CLI) across swappable backends (local, Docker, VM, Cloud). **Automations** run on schedule/webhook and integrate Slack/GitHub/Linear/Notion. ([github.com/All-Hands-AI/OpenHands](https://github.com/All-Hands-AI/OpenHands))
- **ACP as extensibility primitive** — Agent Canvas spawns the agent's own CLI subprocess, relays JSON-RPC over stdio. Each provider's stored login (macOS Keychain, `~/.codex/auth.json`, `~/.gemini/oauth_creds.json`) auto-detected and takes priority over API keys. ([/openhands/usage/agent-canvas/acp-agents](https://docs.openhands.dev/openhands/usage/agent-canvas/acp-agents))
- Skills follow the now-standard `.agents/skills/SKILL.md` convention.

**Cline:**

- SDK + CLI + VS Code + JetBrains + **Kanban** (parallel agents each in own worktree, auto-commit, dependency chains) + **scheduled agents** (cron) + **messaging connectors** (Telegram/Slack/Discord/WhatsApp/Google Chat/Linear, each thread = session). ([github.com/cline/cline](https://github.com/cline/cline))
- **`createTool` SDK** — schema-first tool definition with `inputSchema` (JSON Schema) + `execute`. Plugins register tools + lifecycle hooks; MCP servers add more. Multi-agent "teams" with a coordinator delegating to specialists; team state persists across sessions. Rules in `.clinerules`, skills in `.cline/skills/`.

### 9.2 Hermes (Nous Research)

**Function-calling format** — XML-wrapped, JSON-payload, layered on ChatML (Hermes 2/3/4-14B) or Llama-3 chat (Hermes 4 70B/405B). Tool defs use the OpenAI tool-schema shape but are injected as a string inside `<tools>` tags in the system message. Tool calls emitted as `<tool_call>\n{"name":...,"arguments":...}\n</tool_call>` (special tokens, parseable mid-stream). Tool responses injected as a `tool` role with `<tool_response>` wrapper. Built-in `hermes` parser in vLLM, `qwen25` in SGLang. ([Hermes-3-Llama-3.1-70B card](https://huggingface.co/NousResearch/Hermes-3-Llama-3.1-70B), [Hermes-Function-Calling repo](https://github.com/NousResearch/Hermes-Function-Calling))

**GOAP scaffold (Hermes 3)** — optional `<scratch_pad>` block with Goal / Actions / Observation / Reflection sections, emitted before every tool call. Trained into the model. ([Hermes-Function-Calling README](https://github.com/NousResearch/Hermes-Function-Calling))

**Structured output** — prompt-based JSON-schema mode (`<schema>{schema}</schema>` system injection + Pydantic validation + single repair turn). Hermes 4 explicitly post-trained to self-heal malformed JSON. No native grammar-constrained decoding shipped by Nous; relies on prompt + (optionally) vLLM/SGLang guided-decoding backends. ([Hermes-4-405B-FP8 card](https://huggingface.co/NousResearch/Hermes-4-405B-FP8), [`jsonmode.py`](https://github.com/NousResearch/Hermes-Function-Calling/blob/main/jsonmode.py))

**Hybrid reasoning + tool interleaving (Hermes 4)** — emits `<think>…</think>` blocks that can interleave `<tool_call>` inside a single assistant turn. Toggled via `thinking=True` on the chat template. ([Hermes-4-405B-FP8 card](https://huggingface.co/NousResearch/Hermes-4-405B-FP8))

**Relevant strengths** — tool-use reliability, long context (128k), role-play/persona ("conscious sentient superintelligent AI"), instruction-following, runs fully locally. "Extreme improvements on steerability, especially on reduced refusal rates" — aligned _to user_, not vendor policy. ([Hermes-4-14B card](https://huggingface.co/NousResearch/Hermes-4-14B))

**Novel** — **RefusalBench** (helpfulness-without-refusal benchmark). **Self-healing JSON training.** The `hermes-agent` repo (memory loop, skills, multi-platform gateway) and `hermes-agent-self-evolution` (DSPy+GEPA auto-optimization of skills over time). ([Hermes-4-405B-FP8 card](https://huggingface.co/NousResearch/Hermes-4-405B-FP8), [github.com/NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent), [hermes-agent-self-evolution](https://github.com/NousResearch/hermes-agent-self-evolution))

### 9.3 Raycast / Arc Max / Dia

(Raycast material is woven through §5; see especially §5.1–§5.4.) Key URLs:

- Manifest: [developers.raycast.com/information/manifest.md](https://developers.raycast.com/information/manifest.md)
- Terminology (command/tool/action): [developers.raycast.com/information/terminology.md](https://developers.raycast.com/information/terminology.md)
- Security: [developers.raycast.com/information/security.md](https://developers.raycast.com/information/security.md) — open source, signed, notarized, reviewed, v8-isolate-per-extension, **not further sandboxed** for file I/O/networking (documented as a known limitation).
- AI Commands: [manual.raycast.com/ai/ai-commands](https://manual.raycast.com/ai/ai-commands)
- AI Chat (Quick AI / AI Chat / Memory / Attach Context / Tool Use / Ask User Question): [manual.raycast.com/ai/chat](https://manual.raycast.com/ai/chat)
- AI Extensions: [manual.raycast.com/ai/ai-extensions](https://manual.raycast.com/ai/ai-extensions) — built-in `@`-mention tools: `@browser`, `@calculator`, `@calendar`, `@clipboard`, `@file-search`, `@memory`, `@notes`, `@quicklinks`, `@snippets`, `@terminal`, `@weather`, `@selected-text`, `@apple-health`, `@location`.
- Agents (system prompt + scoped tools + model preset): [manual.raycast.com/ai/agents](https://manual.raycast.com/ai/agents) — built-in **Deep Research**.
- MCP: [manual.raycast.com/ai/model-context-protocol](https://manual.raycast.com/ai/model-context-protocol) — stdio + HTTP, OAuth Dynamic/Static with PKCE, tokens encrypted per-server, ask-before-run default.
- Privacy: [manual.raycast.com/ai/raycast-ai-privacy-security](https://manual.raycast.com/ai/raycast-ai-privacy-security) — no recording, no sensitive info, no prompt logs, not used for training, Memory stored locally encrypted.
- Quicklinks: [manual.raycast.com/quicklinks](https://manual.raycast.com/quicklinks)
- Snippets: [manual.raycast.com/snippets](https://manual.raycast.com/snippets)
- Search bar (frecency, aliases, inline args, deeplinks): [manual.raycast.com/search-bar](https://manual.raycast.com/search-bar)

**Arc Max** — documented features: 5-Second Previews (`Shift`+hover), ChatGPT in Command Bar, Tidy Tab Titles, Tidy Downloads, Instant Links (`Shift+Enter`), Tidy Tabs (auto-organize >6 tabs). "Max features require sending data to our AI partners." ([resources.arc.net/.../Arc-Max-Boost-Your-Browsing-with-AI](https://resources.arc.net/hc/en-us/articles/19335160678679-Arc-Max-Boost-Your-Browsing-with-AI))

**Dia** — successor browser. "Dia reads tabs" (cross-tab synthesis), **Morning Brief** (calendar + inbox + key links), **Reports** (cross-tool synthesis), granular privacy toggles, end-to-end-encrypted sync, **Dia Work** adds SSO + admin tools. ([diabrowser.com](https://diabrowser.com), [/start](https://diabrowser.com/start))

### 9.4 n8n / Windmill / Activepieces

(Full material in §2, §3, §5.) Key URLs:

- **n8n AI Agent node**: [docs.n8n.io/.../langchain.agent](https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent.md)
- **n8n tools** (Call n8n Workflow Tool, Custom Code Tool, HTTP Request Tool): [docs.n8n.io/build/integrate-ai/understand-ai-components/how-tools-work.md](https://docs.n8n.io/build/integrate-ai/understand-ai-components/how-tools-work.md)
- **n8n memory** (Postgres/Redis/Motorhead/Xata/Zep chat memory): [docs.n8n.io/build/integrate-ai/understand-ai-components/how-memory-works.md](https://docs.n8n.io/build/integrate-ai/understand-ai-components/how-memory-works.md)
- **n8n AI Workflow Builder** (secrets excluded): [docs.n8n.io/build/ways-of-building-workflows/ai-workflow-builder.md](https://docs.n8n.io/build/ways-of-building-workflows/ai-workflow-builder.md)
- **n8n evaluations**: [docs.n8n.io/build/integrate-ai/test-and-improve-ai-workflows.md](https://docs.n8n.io/build/integrate-ai/test-and-improve-ai-workflows.md)
- **n8n MCP Server Trigger + MCP Client**: [mcptrigger](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcptrigger.md), [mcpclient](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcpclient.md)
- **n8n harden task runners / SSRF protection**: [harden-task-runners](https://docs.n8n.io/deploy/host-n8n/configure-n8n/security/harden-task-runners.md), [enable-ssrf-protection](https://docs.n8n.io/deploy/host-n8n/configure-n8n/security/enable-ssrf-protection.md)
- **Windmill git sync + workspace forks**: [git_sync](https://docs.windmill.dev/docs/advanced/git_sync), [workspace_forks](https://docs.windmill.dev/docs/advanced/workspace_forks)
- **Windmill AI sandboxes + volumes**: [sandboxes](https://docs.windmill.dev/platform/sandboxes), [volumes](https://docs.windmill.dev/docs/core_concepts/volumes), [security_isolation](https://docs.windmill.dev/docs/advanced/security_isolation)
- **Windmill local dev with AI** (generates `AGENTS.md` for Claude Code/Cursor/MCP): [local_dev_with_ai](https://docs.windmill.dev/docs/misc/guides/local_dev_with_ai)
- **Windmill resources** (typed credentials, RBAC): [resources_and_types](https://docs.windmill.dev/docs/core_concepts/resources_and_types)
- **Activepieces piece definition** (`createPiece`): [piece-definition.md](https://www.activepieces.com/docs/build-pieces/building-pieces/piece-definition.md)
- **Activepieces piece auth** (`PieceAuth.SecretText` / `OAuth2`): [piece-authentication.md](https://www.activepieces.com/docs/build-pieces/building-pieces/piece-authentication.md)
- **Activepieces 7-second hot-reload**: [overview.md](https://www.activepieces.com/docs/build-pieces/building-pieces/overview.md)
- **Activepieces crash recovery / sandboxing**: [crash-recovery.md](https://www.activepieces.com/docs/install/guarantees/crash-recovery.md), [sandboxing.md](https://www.activepieces.com/docs/install/configure-operate/sandboxing.md)

### 9.5 AnythingLLM / PrivateGPT / Khoj

(Full material in §4.) Key URLs:

- **AnythingLLM workspace-as-tenancy + RAG**: [rag-in-anythingllm](https://docs.anythingllm.com/chatting-with-documents/rag-in-anythingllm)
- **AnythingLLM custom agent skills** (`plugin.json` + `handler.js` + `this.requestToolApproval`): [developer-guide](https://docs.anythingllm.com/agent/custom/developer-guide), [plugin-json](https://docs.anythingllm.com/agent/custom/plugin-json), [handler-js](https://docs.anythingllm.com/agent/custom/handler-js)
- **AnythingLLM chat modes** (Query/Chat/Agent + similarity threshold): [chat-modes](https://docs.anythingllm.com/features/chat-modes)
- **AnythingLLM vector DB options** (LanceDB default, pgVector option, 8 total): [vector-databases](https://docs.anythingllm.com/features/vector-databases)
- **PrivateGPT search API** (`expand`, `metadata_filter`, `collection`): [api-reference/primitives/search.md](https://docs.privategpt.dev/api-reference/primitives/search.md)
- **PrivateGPT ingestion** (`make ingest /path --watch`, async): [api-guide/ingestion.md](https://docs.privategpt.dev/api-guide/ingestion.md)
- **PrivateGPT tools** (built-in server tools + custom JSON Schema + code execution + MCP): [api-guide/tools.md](https://docs.privategpt.dev/api-guide/tools.md)
- **PrivateGPT skills** (versioned, immutable `SKILL.md`, `lazy|eager`): [api-guide/skills.md](https://docs.privategpt.dev/api-guide/skills.md)
- **PrivateGPT pure-local posture** ("does not run models itself"): [github.com/zylon-ai/private-gpt](https://github.com/zylon-ai/private-gpt)
- **Khoj data sources** (drag-drop, desktop sync, Obsidian/Emacs, Notion/GitHub OAuth): [share_your_data](https://docs.khoj.dev/data-sources/share_your_data), [notion_integration](https://docs.khoj.dev/data-sources/notion_integration)
- **Khoj automations** (cron → email): [features/automations](https://docs.khoj.dev/features/automations)
- **Khoj agents** (system-prompt-only personas): [features/agents](https://docs.khoj.dev/features/agents)
- **Khoj privacy** (sharded by user ID, no training): [privacy](https://docs.khoj.dev/privacy)

---

## 10. Methodology + grounding

- **Tree state:** grounded on working tree `52138c8c` (main, 2026-07-05). No `pnpm audit:preflight` run (this is research, not an audit), but the capability map was produced from live file reads of the current tree. **Rev 2 note:** `origin/main` has since advanced to `1fc4f3e9` (PR #816), and the reconciliation pass additionally read the 2026-07-04/05 specs on the active coordination branch, which the original grounding could not see.
- **Research method:** six parallel general-purpose subagents, each scoped to one tool family, each instructed to hit primary docs/repos only and cite URLs under each claim. A seventh subagent mapped Jarvis's current capabilities from the codebase using the knowledge graph + file reads. This document is the synthesis; the subagent reports are the raw material.
- **Lens weighting:** equal weight across the four lenses (dev-enablement, autonomy, RAG, UX/integration), per the commissioning question.
- **Citations:** every external claim carries a URL to primary docs or a repo README in §9. Jarvis-internal claims carry a `file:line` citation.
- **What this report is NOT:** it is not a spec. Per `CLAUDE.md:33`, every feature above needs an approved design spec in `docs/superpowers/specs/` before code is written. This report is the _input_ to those specs.
- **Invariants:** §8 is the gating section — no feature in §7 should be specced without first resolving its invariant impact.
