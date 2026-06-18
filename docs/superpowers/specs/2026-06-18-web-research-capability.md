# Web Research Capability

**Status:** Approved
**Date:** 2026-06-18
**Owner:** Ben
**GitHub:** #31

## Goal

Jarvis should answer current-web questions without sending the user to Claude, ChatGPT, Codex, or a
browser. Web access is a core product capability, but network access must still run through Jarvis's
own governed tool path so searches, reads, citations, and source traces are visible to the user and
consistent across model providers.

Product framing: **core Jarvis capability**.

Code framing: a small built-in required `web` module, because the module assistant-tool manifest is
the existing gateway boundary for governed tool execution.

## Current State

The assistant-tool gateway already provides the right control plane:

- `AssistantToolGateway` lists executable tools from active module manifests.
- MCP calls are scoped by a server-minted session token and actor `AccessContext`.
- Per-session tool allowlists are enforced server-side.
- Tool inputs are structurally validated before execution.
- Tool outputs are schema-projected and capped before reaching the model.
- Provider-native tools are constrained by the chat CLI launch posture so Jarvis tools remain the
  intended execution path.

There is no current built-in web search or web read capability.

## V1 Scope

V1 ships a complete, governed web-research loop:

1. Search public web.
2. Read selected search results or user-provided links.
3. Return answer-ready source material with citations and a user-visible research trace.

V1 is not just a search-results list. Jarvis must be able to inspect source pages when needed to
answer the user's question.

## Non-Goals

- No admin surveillance dashboard.
- No parental-control or policy UI.
- No crawler.
- No long-term web cache or local search index.
- No automatic memory writes from web results.
- No autonomous background web monitoring.
- No model-provider-native browsing in production chat.

Future policy controls may build on the trace, but the V1 trace is for user visibility, answer
quality, debugging, and future learning.

## Architecture

Add a new workspace package `@jarv1s/web`.

The package exposes:

- `webModuleManifest`
- `webSearchExecute`
- `webReadExecute`
- provider interfaces and default provider wiring

Register the module in `packages/module-registry` alongside the other built-ins. It is required and
default-enabled, with no navigation entry and no REST route required for V1. It contributes assistant
tools only.

The module owns no private user tables in V1. If the implementation needs durable research traces,
add an owner-scoped table in `packages/web/sql/`; otherwise traces may be returned in tool output and
stored with the chat transcript/tool stream only. Do not write to `admin_audit_events` for normal web
usage in V1.

## Tools

### `web.search`

Risk: `read`.

Purpose: find public web results for a query.

Input:

- `query`: required string.
- `limit`: optional number, capped by server config.
- `freshness`: optional enum such as `any`, `day`, `week`, `month`, if the selected provider supports
  it.

Output:

- `query`
- `results[]`
  - `resultId`
  - `title`
  - `url`
  - `domain`
  - `snippet`
  - `publishedAt` when available
- `trace`
  - provider name
  - result count
  - timeout/cap flags

### `web.read`

Risk: `read`.

Purpose: retrieve and extract readable source text from URLs. URLs may come from prior search results
or from explicit user-provided links.

Input:

- `urls`: required array of strings.
- `goal`: optional string describing what the user wants from the pages.

Output:

- `documents[]`
  - `url`
  - `domain`
  - `title`
  - `text`
  - `excerpt`
  - `fetchedAt`
  - `truncated`
  - `status`
- `trace`
  - requested URL count
  - fetched URL count
  - skipped URL count
  - per-document truncation/error status

`web.read` strips scripts/styles/navigation where possible and returns readable text only. Returned
page text must be labeled in descriptions/prompts as untrusted source material, not instructions.

## Provider Design

Use adapter interfaces from day one:

- `WebSearchProvider.search(input)`
- `WebPageReader.read(urls, options)`

The first implementation may use one hosted search provider and Node's HTTP fetch for page reads, but
the package must not hardcode provider details into the tool handlers. Provider selection comes from
configuration.

If no search provider is configured, the tools fail closed with a clear unavailable result. They must
not fall back to model-native browsing.

## Safety And Limits

V1 must enforce server-side caps:

- Maximum query length.
- Maximum search results.
- Maximum URLs read per tool call.
- Maximum bytes downloaded per URL.
- Maximum extracted characters returned per document.
- Per-request timeout.
- Redirect limit.

The reader must reject non-HTTP(S) URLs and block local/private network targets to avoid SSRF:

- localhost / loopback
- link-local
- private IPv4 ranges
- unique-local IPv6
- file/data/javascript URLs

Fetched content is untrusted. The tool must never execute scripts, submit forms, follow page-directed
actions, or treat page text as tool instructions.

## User-Visible Research Trace

When Jarvis uses web tools, the chat/tool output should make the source path visible:

- search query
- result domains/titles considered
- URLs read
- whether any result was truncated or skipped

This is not an admin-monitoring feature. It is product feedback for the user and debugging context for
answer quality.

## Integration Points

- `packages/module-registry`: register the built-in manifest.
- `packages/shared`: add tool output schemas if shared DTOs are preferred over module-local schema
  constants.
- `packages/chat`: no new provider-native web permissions; production chat continues to rely on
  Jarvis MCP tools.
- `packages/ai`: no special-case web execution; the existing gateway should dispatch these tools like
  any other read tool.

## Testing

Add focused tests for:

- `web.search` returns schema-valid, capped results from a fake provider.
- `web.read` rejects non-HTTP(S), localhost, and private-network URLs.
- `web.read` caps content and marks `truncated`.
- Tool output includes a trace and source URLs.
- Gateway integration lists and calls the web tools through the normal assistant-tool path.
- Provider-native web access remains absent from production chat launch configuration.

## Acceptance Criteria

- Jarvis can answer a current-web question by searching and reading sources through Jarvis tools.
- Responses can cite source URLs returned by the tools.
- The user can see what was searched and read.
- Network access is provider-agnostic and not tied to a model vendor's native browsing.
- The implementation keeps web access inside the assistant-tool gateway.
- `pnpm verify:foundation` passes.

## Follow-Ups

- Domain policy UI and parental/admin controls.
- Durable research history/search trace browser.
- Web result caching.
- Source preference learning.
- Background monitoring or alerts.
- Richer extraction for PDFs and non-HTML documents.
