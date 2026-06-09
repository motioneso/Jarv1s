# 0009 — Module architecture: contribution-point manifest + MCP-shaped AI tools (finish, don't rearchitect)

**Status:** accepted (2026-06-09)
**Context:** "Wellness as the first _optional_ module" requires a per-user **module-enablement**
layer. Before building it we researched (2026-06-09) industry plugin architectures and the MCP
standard, and mapped the current Jarv1s code. Findings:

- **No single module-format standard exists — there is pattern convergence.** VS Code, Home
  Assistant, Obsidian, Backstage, Medusa, etc. all independently land on: a _declarative manifest
  separate from code_, _typed contribution points the core owns_ (modules register, never mutate
  core), _explicit lifecycle with guaranteed teardown_, _hard isolation_, and _declared dependencies
  resolved before activation_. Jarv1s's `module-registry` + manifest + module-isolation invariants
  already sit on this consensus.
- **MCP is the one real standard — for the AI-tool surface only.** It is now cross-vendor and
  Linux-Foundation-governed (Agentic AI Foundation, Dec 2025); Jarv1s already exposes module
  assistant-tools through an **in-process MCP gateway**.
- **The per-user enablement seam is already stubbed:** the gateway calls
  `resolveActiveModules(actorUserId)` per request and the manifest declares
  `availability.{defaultEnabled, required, supportsUserDisable}` — awaiting issue **#30**. It just
  currently ignores the user and returns "all modules on."

## Decision

1. **Keep the model; finish + formalize it — no rearchitecting.** A module stays a **package that
   connects, not alters**, via the manifest + `module-registry` composition root (the cross-industry
   consensus). Ben's "adds to `packages/`, docks into the space station" vision _is_ this pattern.

2. **AI capabilities = MCP-shaped, in-process.** Module assistant-tools use MCP's
   tool/resource/prompt shape (already ~true). Stay **in-process**; out-of-process / remote MCP is a
   _future_ seam, justified only by untrusted third-party modules or exposing Jarv1s as an external
   MCP server. **Do not** push REST routes / migrations / jobs / RLS through MCP — those keep the
   bespoke internal contract.

3. **Per-user enablement = storage + a real resolver, not a contract change.** Implement the existing
   `resolveActiveModules(actorUserId)` to consult a **disabled-modules store** and honor
   `availability.{required, supportsUserDisable}`. AI tools then auto-vanish for disabled modules.
   Add the one genuinely-new mechanism — a **request-time route-enablement guard** (Fastify routes
   register once at boot). Add a **`coreApiVersion` compat gate** so a module can be validated/enabled
   without executing its code.

4. **Finish the wiring:** retire the legacy `AiAssistantToolExecutor` switch so the clean MCP gateway
   is the _only_ tool path (Phase 1); make the manifest the **single source of truth** (consume or
   drop the currently-decorative `routes`/`jobs` fields).

5. **Skip the heavy stuff:** no OSGi-style hot-swap, no per-module semver ranges, no separate
   processes — overkill for a self-hosted assistant.

## Consequences

- Phase 2's "docking ports" is a **build-out of an already-anticipated seam** — low-risk, not a
  refactor. Issue **#30** ("Module Connector") is its home.
- Modules stay swappable additions; Wellness (Phase 5) is the first real exercise of the seam.
- Standards-alignment ("expose Jarv1s modules to an external MCP client") later becomes a transport
  adapter, not a rewrite.
