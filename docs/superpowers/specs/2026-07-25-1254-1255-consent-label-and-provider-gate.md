# Spec — #1254 plain-English approval labels + #1255 chat gate on real model availability

Date: 2026-07-25. Status: DRAFT — awaiting Ben's approval.
Scope: two host-surface defects where the UI states something about system state that is not what the
system actually knows. Grounded on `fd524022` (branch `spec/host-findings-1250-1255`).

## Problem

### A. The approval card names the action in registry vocabulary (#1254)

The Approve/Deny card renders exactly two lines of "what am I agreeing to":

- eyebrow: `humanizeToolName(props.toolName)` — `apps/web/src/chat/action-request-card.tsx:17-20,63`.
  It splits on `.` and keeps the last segment, so `job-search.profile.update` renders as **"Update"**.
- sentence: `props.summary` (`action-request-card.tsx:64`), produced server-side by
  `AssistantToolGateway.summaryFor` (`packages/ai/src/gateway/gateway.ts:556-566`):

  ```ts
  if (typeof tool.summarize === "function") return tool.summarize(input, ctx);
  const generic = summarizeAssistantToolInput(input);
  return `${tool.name} (${String(generic.inputKeyCount ?? 0)} field(s))`;
  ```

`summarize` is a **function** on `ModuleAssistantToolManifest`
(`packages/module-sdk/src/index.ts:510`). A downloadable module declares its tools in JSON
(`ExternalModuleAssistantToolDeclaration`, `packages/module-sdk/src/index.ts:695-703`) and the
external bridge copies only `name / description / permissionId / risk / inputSchema / outputSchema /
execute` onto the runtime manifest (`packages/module-registry/src/external/tool-manifests.ts:36-44`).
No external module can ever carry a `summarize`. So **every** external-module write tool falls into
the generic branch, and the consent sentence is literally
`job-search.profile.update (2 field(s))` — see `external-modules/job-search/jarvis.module.json:22-53`
for the three tools that produce it today.

The card is otherwise written for a human (`Approve` / `Reject` / the email `preview` block at
`action-request-card.tsx:66-80`). The one line that says what will happen is written for the
registry. Approval is a consent surface; a string the user cannot evaluate is not consent.

The card's own `description` field is never shown — the module already writes a human sentence
("Save resume text from an upload, paste, or interview") that the model sees and the user does not.

### B. The drawer's chat gate keys off CLI install lifecycle (#1255)

`apps/web/src/chat/chat-drawer.tsx:171` decides whether chat is usable with:

```ts
const chatAvailable = hasConnectedProvider(onboardingStatusQuery.data);
```

`hasConnectedProvider` (`apps/web/src/onboarding/chat-availability.ts:17-20`) returns

```ts
if (status === undefined || status.role !== "founder") return false;
return status.steps.cliAuth.providers.some((provider) => provider.installState === "ready");
```

That is the CLI install→login→ready lifecycle, not model availability. What the turn actually
requires is `AiRepository.selectChatModelForUser` (`packages/ai/src/repository.ts:1394-1397`), called
by `DataContextChatPersistence.resolveActiveProvider`
(`packages/chat/src/live/persistence.ts:136-152`); a null there throws
`"No active chat-capable model is configured for this user."`, mapped to a 400 at
`packages/chat/src/live-routes.ts:655-657`. The two signals drift in both directions:

1. **Ready CLI, no usable model → drawer looks ready, first turn 400s.** `installState === "ready"`
   says nothing about `app.ai_configured_models`. A model disabled in Admin, a provider row moved to
   `error`/`revoked`, or an admin pin that cannot serve `chat` all leave the install state at `ready`
   while `resolveModelForCapability` returns `{ model: null, reason: "admin-pin-unavailable" }` or
   `"needs-config"` (`packages/ai/src/repository.ts:1075-1078,1114,1151-1167`). The drawer then shows
   the seed suggestions, and the user's first message fails with a 400 they cannot act on.
2. **Usable model, drawer says unavailable.** Two concrete cases:
   - **Every member.** `hasConnectedProvider` returns `false` for `role !== "founder"` because
     `OnboardingMemberStatus` carries no `steps.cliAuth`
     (`packages/shared/src/onboarding-api.ts:160-172`). A member on an instance with working chat is
     shown `ConnectProviderEmpty` — "Chat isn't available until an AI provider is connected for this
     instance" (`apps/web/src/chat/connect-provider-empty.tsx:22-27`) — which is false.
   - **Per-user model override.** The turn resolves `selectedModel = override ?? defaultModel`
     (`packages/ai/src/chat-model-override.ts:39-42`, reached via `getChatModelOverrideSettings`,
     `packages/ai/src/repository.ts:1399-1443`). A user whose override resolves an active chat model
     can chat even when the instance-level route does not.

The drawer already fetches the router's answer and throws most of it away:
`lookupAiCapabilityRoute("chat")` at `chat-drawer.tsx:164-170` is read **only** for
`reason === "admin-pin-unavailable"`. `GET /api/ai/capability-route/:capability`
(`packages/ai/src/capability-route-routes.ts:42-65`) already returns
`{ available: Boolean(route.model), reason, model }`. It is still not quite the right question: it
calls `resolveModelForCapability` directly, so it misses the per-user override layer that the turn
path applies on top.

## Design

### Fix 1 — `actionLabel`: a manifest-declared plain-English action label (#1254)

**SDK (protocol).** Add one optional field in `packages/module-sdk/src/index.ts`:

- `ExternalModuleAssistantToolDeclaration.actionLabel?: string` (line ~695-703) — the JSON ABI.
- `ModuleAssistantToolManifest.actionLabel?: string` (line ~499-538) — the runtime manifest, so
  built-in modules can declare it too.

Contract: an imperative sentence naming what the user is approving, written for the user
("Save your job-search profile"). Not a description of the tool, not the tool name. Plain text,
1-80 chars, no control characters. Never interpolated with input values (that is Fix 2's job) so it
can never carry model-produced text.

**Validation path** (this is the gate a public protocol change must pass through). All line numbers
below are grounded on `fd524022` and **must be re-resolved after `build/js-03-perms` (`ee7ca045`,
#1234) merges** — that branch edits every file in this path and lands on main before this spec is
built.

1. `packages/module-registry/src/external/validate.ts:421-458` — inside the per-tool loop, validate
   `actionLabel` positively when present: string, 1-80 chars after trim, no C0/C1 control
   characters, mirroring the `assistantOnboarding` string checks at `validate.ts:461-487`. Invalid ⇒
   manifest rejected (the module fails to register), consistent with every other manifest error.
2. **Harden the same loop with unknown-key rejection.** Today the validated manifest passes
   `obj.assistantTools` through by cast (`validate.ts:675-677`) with no key allowlist — unlike
   `navigation` (`validate.ts:570-575`) and `database` (`validate.ts:543`), which reject unknown
   fields outright. Add an allowlist so a manifest cannot smuggle built-in-only tool fields
   (`executionPolicy`, `actionFamilyId`, `requiresServices`, `externalContent`) through the ABI:

   ```ts
   const ALLOWED_TOOL_KEYS = [
     "name",
     "description",
     "permissionId",
     "risk",
     "inputSchema",
     "outputSchema",
     "handler",
     "surfacesResultToUi",
     "actionLabel",
     "inputFields"
   ] as const;
   ```

   Those built-in-only fields are already dropped at `tool-manifests.ts:36-44`, so this is defense
   in depth, not a live hole — but the new field is the moment to close it.

   **`surfacesResultToUi` is load-bearing in that list.** It does not exist on `fd524022`; it
   arrives with `build/js-03-perms` (`ee7ca045`), which adds it to the JSON ABI and the runtime
   manifest (`packages/module-sdk/src/index.ts:364,556`), validates it in this same per-tool loop
   (`validate.ts:374-375`), and copies it in the allowlist (`tool-manifests.ts:81`). If the
   allowlist lands without it, unknown-key rejection will reject **every** manifest declaring
   `surfacesResultToUi` — including the shipped job-search manifest — and the résumé-review card
   that #1234 exists to deliver stops rendering. Whoever implements this must diff the allowlist
   against the merged `tool-manifests.ts` copy list, not against the list written here.

3. `packages/module-registry/src/external/tool-manifests.ts:36-44` — add `actionLabel` (and Fix 2's
   `inputFields`) to the allowlist copy, alongside the `surfacesResultToUi` entry JS-03 adds at
   `:81`. Fields not listed here still never reach the gateway.

**Versioning.** `schemaVersion` stays the literal `1` (`validate.ts:659`) and `CORE_VERSION` stays
`0.1.0` (`packages/module-sdk/src/core-version.ts:7`). This is an **additive optional** field, the
same shape of change as `database` (#964), `navigation` (#1019), and `assistantOnboarding`, none of
which bumped either version. The closest precedent is `surfacesResultToUi` on `build/js-03-perms`
(`ee7ca045`, #1234): an additive optional field on the assistant-tool declaration **itself**, shipped
through this exact path (`module-sdk/src/index.ts:364,556` → `validate.ts:374-375` →
`tool-manifests.ts:81`) with no `schemaVersion` and no `CORE_VERSION` bump. Both drift directions are
safe:

- **Module without the field on new core** → `actionLabel` is `undefined` → the gateway falls back to
  today's generic sentence. No behavior change.
- **Module with the field on old core** → old `validate.ts` ignores unknown tool keys and old
  `tool-manifests.ts` does not copy it. The module installs and runs, unlabelled.

Document the field in `docs/module-developer-guide.md` §11 (line 332-337) alongside the existing
`risk` / `executionPolicy` guidance.

**Gateway.** `packages/ai/src/gateway/gateway.ts`:

- `summaryFor` (`:556-566`) precedence becomes `summarize()` → `actionLabel` → generic fallback.
  `summarize` stays first: it is per-call and can be more specific than a static label.
- `confirmAndRun` (`:506-512`) adds `moduleName: found.dto.moduleName` to the emitted
  `action_request` record so the card's eyebrow can name the module rather than a verb fragment.

**Streamed record.** `packages/ai/src/gateway/types.ts:23-37` — add `moduleName?: string` (and Fix
2's `fields?`) to the `action_request` variant. `packages/chat/src/gateway-notifier.ts:29-38` carries
them into the `TranscriptRecord`; `apps/web/src/chat/use-chat-stream.ts:29-43,185-195` parses them
with the same defensive `typeof === "string"` guards used for `toolName`/`summary`.

**Card.** `apps/web/src/chat/action-request-card.tsx` — copy change only, no visual redesign:

- eyebrow (`:63`) renders `props.moduleName ?? humanizeToolName(props.toolName)`. `humanizeToolName`
  stays as the fallback, exactly as the issue asks.
- sentence (`:64`) is unchanged code — it already renders whatever `summary` the gateway sent, which
  is now the label.

Existing classes (`action-request-preview__label` mono-uppercase eyebrow at
`apps/web/src/styles/kit-chat.css:827-836`, `action-request-summary` at `:795-800`) are reused
verbatim. No new CSS, no new tokens.

**Module.** Add `actionLabel` to all three tools in
`external-modules/job-search/jarvis.module.json:22-53` and bump the module `version`, so the fix is
observable in UAT:

- `job-search.profiles.list` → "Look at your saved job-search profiles"
- `job-search.resume.intake` → "Save your résumé to your private vault"
- `job-search.resume.critique` → "Review your résumé and draft revisions"

### Fix 2 — `inputFields`: the card can say _what_ is being saved (#1254, second half)

`actionLabel` alone still leaves the card silent about the values. Add an optional, tightly-capped
declaration of which **top-level input properties** the card may show:

- SDK: `ExternalModuleAssistantToolDeclaration.inputFields?: readonly { key: string; label: string }[]`
  and the same on `ModuleAssistantToolManifest`. Max 4 entries; `key` must name a property that
  exists in the tool's own `inputSchema.properties` (validated in `validate.ts`, so a module cannot
  declare a field it does not accept); `label` 1-24 chars plain text.
- Gateway (`confirmAndRun`, `:487-505`): for each declared field, read `input[key]`, coerce
  `string | number | boolean` only (objects/arrays/undefined are skipped), strip control characters,
  truncate to 120 chars, and emit as `fields: readonly { label: string; value: string }[]` on the
  `action_request` record.
- Card: render `fields` with the **existing** `action-request-preview` `<dl>` rows
  (`action-request-card.tsx:66-80`, CSS at `kit-chat.css:807-843`) — the same authored pattern the
  email preview already uses. `preview` (email) wins when both are present.

**Persistence invariant preserved.** `fields` rides the live stream only, exactly like `preview`
(`packages/ai/src/gateway/types.ts:29-36`). The durable row's `inputSummary` stays key-names-only
(`summarizeAssistantToolInput`, `packages/ai/src/assistant-tools.ts:36-51`) — no private content
enters `action_requests`, logs, or job payloads.

### Fix 3 — gate chat on the router's answer, not on install state (#1255)

**New repository method.** `packages/ai/src/repository.ts`, next to `getChatModelOverrideSettings`
(`:1399`):

```ts
async resolveChatAvailability(scopedDb: DataContextDb): Promise<ChatAvailability> {
  const settings = await this.getChatModelOverrideSettings(scopedDb);
  if (settings.selectedModel) return { available: true, reason: "ready" };
  const route = await this.resolveModelForCapability(scopedDb, "chat");
  return {
    available: false,
    reason: route.reason === "admin-pin-unavailable" ? "admin-pin-unavailable" : "needs-config"
  };
}
```

This is availability **by construction**: `settings.selectedModel` is the exact value
`selectChatModelForUser` returns (`:1394-1397`) and therefore the exact value the turn path requires
(`packages/chat/src/live/persistence.ts:139-145`). It cannot drift from the turn, in either
direction, without the turn changing too. It does not recurse: `getChatModelOverrideSettings` calls
`selectModelForCapability`, never this method.

**New endpoint.** `GET /api/ai/chat-availability`, registered in
`packages/ai/src/capability-route-routes.ts` alongside the existing capability-route lookup
(`:42-65`), resolved under `dataContext.withDataContext(accessContext, …)` like every route in that
file. Response:

```ts
{
  availability: {
    available: boolean;
    reason: "ready" | "needs-config" | "admin-pin-unavailable";
  }
}
```

- **No model, provider, or credential detail** — a boolean plus a three-value enum. It cannot leak
  credential state, provider identity, or model ids, so it is safe for members and non-admins. This
  is deliberately narrower than `AiCapabilityRouteDto` (`packages/shared/src/ai-types.ts:73-78`),
  which carries a serialized model.
- **Provider-agnostic** — the drawer stops reasoning about CLI provider kinds entirely, which moves
  it toward the invariant rather than away from it.

Types + schema: `packages/shared/src/ai-types.ts` (next to `AiCapabilityRouteReason`, `:25-36`) and
`packages/shared/src/ai-api.ts` (response + route schema next to
`lookupAiCapabilityRouteResponseSchema` `:477-484` / `lookupAiCapabilityRouteRouteSchema` `:730-737`).
Declare every emitted field in the response schema — `fast-json-stringify` silently drops undeclared
properties.

**Why a new endpoint rather than changing `/api/ai/capability-route/chat`.** That route is also the
admin surface (`apps/web/src/settings/settings-ai-admin-pane.tsx:397-448` renders the service row and
its `needs-config` prompt) and must keep showing the **instance route**, not the caller's personal
override. Folding a per-user override into it would make the admin pane lie in the other direction.

**Client.**

- `apps/web/src/api/client.ts` — `getChatAvailability()` next to `lookupAiCapabilityRoute`
  (`:1048-1054`).
- `apps/web/src/api/query-keys.ts` — `ai.chatAvailability: ["ai", "chat-availability"]` (next to
  `capability`, `:55-56`).
- `apps/web/src/onboarding/chat-availability.ts` — delete `hasConnectedProvider` (`:17-20`); the file
  keeps `isNoActiveChatModelError` (`:28-34`), which stays the correct read of the 400.
- `apps/web/src/chat/chat-drawer.tsx:158-171` — replace both queries with the one availability query:
  `chatAvailable = data?.availability.available === true` and
  `lockedModelUnavailable = data?.availability.reason === "admin-pin-unavailable"`. The
  `onboardingStatusQuery` guard at `:492` becomes the availability query's `isSuccess`, so the drawer
  never flashes `ConnectProviderEmpty` before the answer arrives (existing authored loading behavior
  preserved).
- `apps/web/src/onboarding/onboarding-wizard.tsx:147` and
  `apps/web/src/onboarding/skip-confirm.tsx:15` switch to the same source. They ask the identical
  question ("can this person actually chat?") and #1255's stated harm is the first-run experience,
  which is precisely these two surfaces. Leaving them on install state would keep the bug where the
  bug was reported.
- **Invalidation:** invalidate `queryKeys.ai.chatAvailability` wherever AI config or provider state
  changes — `apps/web/src/app.tsx:224` and `apps/web/src/onboarding/onboarding-wizard.tsx:97` (which
  today invalidate `queryKeys.onboarding.status`), plus the model/provider/pin mutations in
  `apps/web/src/settings/settings-ai-admin-pane.tsx`. Without this the drawer keeps a stale "connect
  a provider" state after the founder finishes connecting.

`ConnectProviderEmpty` copy (`apps/web/src/chat/connect-provider-empty.tsx:22-27`) is unchanged for
`needs-config`. It is now shown only when a model genuinely cannot be resolved, which is when its
copy is true.

## Testing

**Unit (`tests/unit/`)**

- `external-tool-manifests.test.ts` (existing) — `actionLabel` and `inputFields` survive the
  allowlist copy; a tool declaring `executionPolicy` / `requiresServices` does not.
- `external-module-validate.test.ts` (existing manifest-validation suite) — `actionLabel` accepted at
  1 and 80 chars; rejected at 0, 81, and with a control character; `inputFields` rejected when it
  names a key absent from `inputSchema.properties`, when it exceeds 4 entries, and when `label` is
  too long; an unknown key inside an `assistantTools` entry is now rejected; a manifest with **no**
  `actionLabel` still validates (compat).
- `gateway-action-preview.test.ts` (existing) — `summaryFor` precedence: `summarize()` wins over
  `actionLabel`; `actionLabel` wins over the generic `name (N field(s))`; neither present ⇒ generic
  string unchanged. `fields` projection: declared keys only, non-scalar values skipped, 120-char
  truncation, control characters stripped, and `inputSummary` on the persisted row still
  key-names-only.
- `action-request-card-preview.test.tsx` (existing) — eyebrow renders `moduleName` when present and
  falls back to `humanizeToolName` when absent; `fields` render as preview rows; `preview` (email)
  still wins over `fields`.
- `onboarding-chat-availability.test.ts` (existing) — drop the `hasConnectedProvider` block; keep
  `isNoActiveChatModelError`.
- `chat-availability-resolution.test.ts` (new) — `resolveChatAvailability`: model resolved ⇒ `ready`;
  override resolves while the instance route does not ⇒ `ready` (the case today's gate gets
  backwards); pin that cannot serve chat ⇒ `admin-pin-unavailable`; nothing configured ⇒
  `needs-config`. **Invariant assertion:** for each fixture,
  `availability.available === ((await selectChatModelForUser(db)) !== null)`.

**Integration (`tests/integration/`)**

- `ai-chat-availability-route.test.ts` (new) — `GET /api/ai/chat-availability` via `app.inject`: 401
  unauthenticated; a member with a working instance model gets `available: true` (today's
  member-always-false bug); the response body contains **only** `available` + `reason` (no model,
  provider, or credential field survives the response schema).

**e2e — mocked (`tests/e2e/`)**

- `chat-drawer.spec.ts` (existing, `mock-ai-api.ts`) — availability `false`/`needs-config` renders
  `ConnectProviderEmpty`; `true` renders the seed suggestions; `admin-pin-unavailable` disables the
  composer (`chat-drawer.tsx:704`).

**e2e — real dev instance (exit criterion, per the #1000-harness rule)**

- `tests/uat/specs/1254-1255-consent-and-availability.uat.spec.ts` (new), run by `pnpm test:uat`
  against a provisioned instance:
  1. With a provider connected and a chat model configured, the drawer opens to the seeds (not
     `ConnectProviderEmpty`) and a turn succeeds.
  2. Disable the chat model in Admin → reopen the drawer → `ConnectProviderEmpty` appears **without**
     sending a failing turn first (proves the gate now leads the failure instead of trailing it).
  3. Drive the job-search résumé-intake tool to a pending approval card and assert the card shows the
     module name in the eyebrow and the plain-English `actionLabel` sentence, and that the raw string
     `job-search.resume.intake` appears nowhere in the card's text content.

## Non-goals

- No visual redesign of the approval card. Copy + one eyebrow source change; existing `jds-*` /
  `action-request-*` classes and `tokens.css` untouched.
- Native-tool confirm copy. `nativeToolSummary` (`packages/ai/src/gateway/gateway.ts:782-785`) emits
  `"Claude wants to use native Read (1 field(s))"` — same raw-name defect **and** a hardcoded provider
  name in user-facing copy. Different surface (#1157 lineage); file separately.
- Localization of `actionLabel`. Single-string, module-authored, English, like every other manifest
  string today.
- Re-hydrating pending approval cards from `action_requests` rows after a reload. Cards are
  live-stream only today; unchanged here.
- Making `actionLabel` mandatory, or retrofitting labels onto modules other than `job-search`.
- Any change to how the turn resolves a model. Fix 3 only makes the UI ask the question the turn
  already answers.
- The hardcoded `found.dto.name === "job-search.resume.critique"` result gate. On `fd524022` it
  appears at **three** sites — `packages/ai/src/gateway/gateway.ts:167`, `:188`, and `:543`, one copy
  each on the yolo, auto-run, and confirmed paths. **This is already fixed**: `build/js-03-perms`
  (`ee7ca045`, #1234) deletes all three and replaces them with a single helper at `gateway.ts:75`
  gated on the manifest's `surfacesResultToUi`. Nothing to file — do not re-report it as a defect
  against a fix that has shipped.

## Open questions for Ben

1. **Do the onboarding wizard and skip-confirm switch too, or only the drawer?** #1255 names the
   drawer; the same function backs `onboarding-wizard.tsx:147` and `skip-confirm.tsx:15`.
   **Recommendation: switch all three.** The reported harm is first-run confusion, which is exactly
   those surfaces, and leaving one caller on install state means keeping `hasConnectedProvider` alive
   as a second, contradictory definition of "can I chat".
2. **Ship `inputFields` (Fix 2) now or split it?** **Recommendation: ship it now.** With only
   `actionLabel`, the card says "Save your résumé to your private vault" and nothing about which
   résumé — the consent gap narrows but does not close. The caps are tight and it reuses the
   `preview` machinery and its live-only persistence rule.
3. **Should `actionLabel` become required for `risk: "write" | "destructive"` tools in a later core
   version?** **Recommendation: not now — revisit when a second external module ships write tools.**
   Requiring it today would reject already-installed modules at registration for a copy defect.
