# Scout Report — Issue #1191 (Assistant persona Preview response CLI failure)

**Run:** `2026-07-19-1179-pdf-bundle`
**Scout:** read-only, no edits/commits/issues/annotation resolutions.
**Coordinator target:** label `Coordinator`, Codex session `019f7c2e-9662-7fd0-ab3e-694241b334ae`.
**Scope:** diagnose end-to-end why Settings → Assistant → **Preview response** fails with a CLI
error, identify the precise seam, smallest safe fix, tests/live proof, risk tier.

## 1. Reproduction / observed symptom

- UI: `apps/web/src/settings/settings-ai-pane.tsx:108-119` — `previewMutation` calls
  `previewPersona(...)`. On error it toasts the raw `error.message`.
- Route: `POST /api/me/persona/preview` (`packages/settings/src/persona-routes.ts:79-113`) delegates
  to `dependencies.personaPreview(...)` and routes any thrown `HttpError` through
  `handleSettingsRouteError`. If `personaPreview` is unset it throws `503 "Persona preview is not
configured"`.
- Live instance on `5178`/`3020` boots **socket-configured** (verified: `JARVIS_CLI_RUNNER_SOCKET=/run/jarv1s/cli-runner-qa-1180.sock` in api env). The cli-runner reached the Claude prompt after the
  trust-prompt fix, but provider auth in the isolated volume was not completed before the run paused
  (per `2026-07-19-1179-pdf-bundle.md` lines 57, 77, 86). With no usable chat-capable model the
  preview toast surfaces the raw CLI/transport cause.

## 2. Root cause (evidence)

### 2.1 Effective composition is correct — the wiring exists

`packages/module-registry/src/index.ts:2108` injects
`createCliStructuredAdapter: createCliStructuredAdapterFactory(structuredChatEngineFactory)`
into `createDefaultPersonaPreview` (lines 1007-1011). `structuredChatEngineFactory`
(`index.ts:2030-2034`, defined at `525-538`) routes through the RPC connection when
`socketConfigured` is true, falling back to the in-process engine otherwise. So **`personaPreview`
IS wired through the real CLI transport** — the failure is *not* a missing dependency.

### 2.2 The failure is in `createDefaultPersonaPreview`'s selection/dispatch chain

`packages/module-registry/src/built-in-module-helpers.ts:66-171` is the preview body. Branch order
on the **effective per-user chat model** (`aiRepository.selectChatModelForUser`):

1. `model == null` → `HttpError(503, "No active chat-capable model is configured")`. **This is the
   actual current failure on the live instance**: no chat-capable model is registered for the new
   user in the isolated QA DB (`jarvis_qa_1180`) because provider login was not completed.
2. `provider.auth_method === "cli"` with no `createCliStructuredAdapter` → `HttpError(503, "CLI
   preview transport is unavailable; start the CLI runner or multiplexer")`. Wired, so not hit
   today — but this is the exact string that would fire on a host-dev path if the engine factory
   were unresolved.
3. CLI run failure → `HttpError(503, "CLI preview failed; check the selected CLI login and
   transport")` (catch-all, line 132-136).
4. API-key path: `HttpApiAdapter.generateChat` failure → `HttpError(503, "The selected chat
   provider could not generate a preview response")` (line 163-168).

### 2.3 Why the toast reads like a "CLI error" without recovery guidance

`packages/settings/src/route-error.ts` (`handleSettingsRouteError`) maps `HttpError` to a status
and body, and the UI (`settings-ai-pane.tsx:116-118`) toasts `error.message` verbatim. Two defects:

- **Defect A — the `503` messages name the transport but not the user action.** The user-facing
  copy is "No active chat-capable model is configured" / "CLI preview failed; check the selected
  CLI login and transport" / "The selected chat model provider is unavailable". None of these tell
  the user *where to fix it* (Admin → Assistant & AI, or finish onboarding login), and "CLI" is
  internal vocabulary — exactly what `mrs776lh-bmzmj5` and `mrs77jy9-33ynvd` flag.
- **Defect B — the catch-all at `built-in-module-helpers.ts:130-136` swallows the original cause.**
  The `HttpError` rethrow at line 131 keeps prior safe messages, but the catch on line 132 discards
  `error.message` from the engine. So a structured-adapter timeout (`CliChatUnavailableError`:
  "CLI structured generation timed out"), a missing-connection (`cli-runner RPC connection is not
  ready" — `index.ts:534`), an already-busy adapter (`CLI structured generation is already busy`,
  `cli-structured-adapter.ts:39`), or a no-reply completion (`CLI structured generation completed
  without a reply`, line 106) all collapse to "CLI preview failed; check the selected CLI login and
  transport" — wrong diagnosis. "check the CLI login" is misleading when the real cause is a
  timeout, busy adapter, or missing RPC connection.

### 2.4 Confirmed by reading the adapter path

`packages/chat/src/live/cli-structured-adapter.ts` raises at least four distinct failures:

| Condition | Thrown | Currently mapped to |
| --- | --- | --- |
| another structured run in flight (line 38-40) | `CliChatUnavailableError("CLI structured generation is already busy")` | "CLI preview failed; check the selected CLI login and transport" ❌ |
| 120 s timeout (line 56-60) | `CliChatUnavailableError("CLI structured generation timed out")` | same ❌ |
| `complete` with no reply (line 104-106) | `CliChatUnavailableError("CLI structured generation completed without a reply")` | same ❌ |
| socket path, RPC not yet adopted (`createStructuredChatEngineFactory`, `index.ts:532-535`) | `CliChatUnavailableError("cli-runner RPC connection is not ready")` | same ❌ |

All four are transport-side hiccups, **not** a login problem. Telling the user to "check the CLI
login" sends them down the wrong recovery path — that is the UX defect behind the two annotations.

### 2.5 Unit + integration coverage today

- `tests/unit/settings-persona-preview.test.ts` (167 lines): covers no-model, missing-CLI-adapter,
  API success/failure, missing-API-credential. **No assertion for the CLI catch-all branch
  (lines 130-136)** — i.e. the misleading "check the CLI login" message has no test pinning it.
- `tests/integration/settings-persona.test.ts` stubs `personaPreview`, so the live transport path
  is not exercised end-to-end.
- `tests/unit/chat-runtime-selection.test.ts` proves RPC-selection works for structured engines,
  but no test asserts the **error-mapping** through `createDefaultPersonaPreview`.

So #991 shipped the green path and the explicit missing-model/missing-credential paths; the
transport-failure translation gap is the open hole #1191 exists to close.

## 3. Exact symbols / files

- `packages/module-registry/src/built-in-module-helpers.ts:66-171` —
  `createDefaultPersonaPreview` (selection + error mapping; the fix target).
- `packages/module-registry/src/built-in-module-helpers.ts:130-136` — CLI catch-all that collapses
  every transport failure to one misleading message.
- `packages/module-registry/src/index.ts:525-538` — `createStructuredChatEngineFactory`.
- `packages/module-registry/src/index.ts:2030-2034, 2104-2111` — preview composition wiring.
- `packages/chat/src/live/cli-structured-adapter.ts:38-40, 56-60, 104-106` — distinct
  `CliChatUnavailableError` causes that should not be re-blamed on the CLI login.
- `packages/settings/src/persona-routes.ts:79-113` and `packages/settings/src/route-error.ts` —
  status→body mapping (UI-safe; no change needed unless copy moves server-side).
- `apps/web/src/settings/settings-ai-pane.tsx:108-119, 133, 231-250` — UI toast + preview bubble;
  `toast(error.message)` is the surface users read.
- `apps/web/src/settings/settings-persona-preview.ts` — pure client helpers (no change).

## 4. Smallest safe fix

Do NOT patch the toast alone (issue explicitly forbids it). Make the failure translation honest at
the source and tighten coverage:

1. **Differentiate transport causes in `built-in-module-helpers.ts` CLI catch (lines 130-136).**
   Match on `error.name === "CliChatUnavailableError"` (or `error instanceof CliChatUnavailableError`
   via a re-export from `@jarv1s/chat`) and produce a UI-safe, recovery-oriented `HttpError(503,
   ...)`. Suggested mapping, all devoid of internal tokens and credential material:

   - already-busy / timed-out / no-reply / RPC-not-ready → "Jarvis's chat engine is briefly busy
     finishing something else. Wait a few seconds and try Preview again." (transient, retry).
   - otherwise (truly unknown) → "Jarvis can't reach the chat engine right now. Open **Admin →
     Assistant & AI** to check the provider connection, then retry."

   Re-blaming ONLY on login happens when the underlying message literally mentions "login"/"auth"
   or the model row reports unauthenticated; otherwise default to the transient retry copy.
2. **Keep all other branches** (no-model, missing-API-credential, API provider failure) as today —
   their copy is already accurate; only the "where to fix" hint is worth adding for the no-model
   case ("…Ask your admin to connect a provider in **Admin → Assistant & AI**, or finish onboarding
   CLI login.").
3. **No transport/schema/route/DTO/credential/RLS change.** No new persistence, no new env, no new
   route, no second CLI runner. The fix is messages + one targeted `instanceof` branch plus tests.
4. **Tests** (the issue's "focused coverage proves the root-cause path and error mapping"):
   - In `tests/unit/settings-persona-preview.test.ts` add cases that inject a fake
     `createCliStructuredAdapter` whose `generateStructured` rejects with each
     `CliChatUnavailableError` variant, and assert the resulting message is the *transient retry*
     copy, never the login-check copy and never the raw engine string.
   - Add one case asserting an unknown `Error("provider secret-key failure")`-style thrown string
     is **not** leaked (mirrors the existing API-side secret-leak guard).
   - Optional: extend `tests/integration/settings-persona.test.ts` with one case where the injected
     `personaPreview` throws an `HttpError(503, "...busy...")` and assert the route returns 503 with
     the safe body, locking the seam.
5. **UI** (optional, smallest): in `settings-ai-pane.tsx` preview error toast, prefix a short
   fallback like "Couldn't preview — <message>." so users can tell this is a preview-only error
   and not a global app failure. The existing toast already shows `error.message`; do not expand
   scope beyond copy.

## 5. Live-proof plan (issue §acceptance: success + one safe failure)

Instance ready at web `5178`, API `3020`, DB `jarvis_qa_1180`, socket-configured (env verified).
Two proof paths:

- **Success:** complete provider login on the isolated auth volume (the path already proven to
  reach the Claude prompt — `2026-07-19-1179-pdf-bundle.md` lines 86, 88), then Settings →
  Assistant → Preview response → assert the bubble renders a real generated reply and no toast.
  Reuses the existing CLI structured adapter; no API credential needed for the CLI-backed model.
- **Safe failure:** with no model registered (today's state) OR temporarily block the RPC socket,
  click Preview response → assert the toast shows the new recovery copy (transient retry OR admin
  provider guidance), contains no stack trace, no `CliChatUnavailableError` text, and no credential
  fragment. Screenshot only the bubble + toast; redact any username.

Both can be captured in one browser session; the success path doubles as the #1179 PDF-drawer
provider-login unblock since both depend on the same auth volume.

## 6. Risk tier

**Routine.**

- No auth, session, token, RLS, secret, schema, migration, export, deletion, shared-table,
  rate-limit, or cross-module contract change.
- Touches one composition helper's error mapping and unit/integration test additions; messages are
  UI-safe by construction.
- Serialized with any lane editing `packages/module-registry/src/built-in-module-helpers.ts` or
  `packages/chat/src/live/cli-structured-adapter.ts`. Current main has no such open lane (#1179 PDF
  work is in `packages/chat/src/attachments-service.ts`; #1182/#1185 are different scopes).
- Live-path gate still applies: the success proof requires a configured chat provider in the
  isolated DB; until login is completed only the safe-failure proof is recordable.

## 7. Collision / dependency notes for the Coordinator

- Do NOT start this build while a parallel lane is editing `built-in-module-helpers.ts`. Run after
  #1179 merges or as its own serialized lane; the only shared file with the broader chat stack is
  the import of `CliChatUnavailableError` from `@jarv1s/chat` (already re-exported at
  `packages/chat/src/live/runtime.ts:40`).
- The two annotations (`mrs776lh-bmzmj5`, `mrs77jy9-33ynvd`) stay **pending** per the closure
  protocol in `2026-07-19-agentation-decisions-needed.md` §"Comment closure protocol" until the fix
  is implemented, verified live (both success and safe-failure), and the user confirms the new copy.
- Issue #1191 is currently `needs-spec`-class (no approved spec yet). This scout is diagnosis only;
  the next step is a spec/plan (`docs/superpowers/specs/...` + paired plan) before any build lane.

## 8. Verdict

Root cause: the preview transport is wired correctly, but `createDefaultPersonaPreview`'s CLI
catch-all collapses every `CliChatUnavailableError` (busy / timeout / no-reply / RPC-not-ready) into
a single "check the CLI login" message, and the no-model path names no recovery location — so the
user sees a "CLI error" toast that points at the wrong remediation. Smallest fix: differentiate the
transport causes into a transient-retry copy and an admin-provider copy at
`built-in-module-helpers.ts:130-136`, plus focused error-mapping tests. Risk: routine.
