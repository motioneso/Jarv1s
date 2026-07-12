# Voice (STT) settings — dedicated admin section

- **Issue:** #874 (Part of epic #869)
- **Status:** DRAFT v2 — Fable 5 adversarial review folded in (2026-07-08). Awaiting owner approval before implementation (build-needs-a-task-issue rule).
- **Depends on:** Slice 1 (#870) landing first; this supersedes its Voice service row.

## Goal

Give the instance admin a **dedicated Voice section** in the AI admin settings to configure
speech-to-text, kept visually and conceptually separate from the LLM provider list. Users get a
mic button in the chat composer that just works: click, talk, the transcript lands in the input.

**Success:** an admin pastes an OpenAI-compatible STT base URL + API key + model name into a Voice
section, saves, and the mic button in chat becomes live for everyone — no LLM-provider plumbing
touched, no per-user setup.

## Why a separate section (design rationale)

Voice is a different modality with a different execution path:

- Transcription already executes over **direct HTTP** (`packages/ai/src/transcription-routes.ts`
  → `HttpApiAdapter`), not the CLI bridge that chat rides (M-A3).
- STT vendors (Groq/Whisper, OpenAI, Deepgram) are not the chat-LLM vendor set. Forcing an admin to
  "add Groq as an LLM provider" just to get Whisper is the wrong mental model.

The separation is **UX-level**. It reuses the existing credential-encryption (`AiSecretCipher`) and
`HttpApiAdapter` machinery — it does **not** fork a parallel provider/credential stack.

## What already exists (grounded in code — do not rebuild)

- **The entire user-facing mic experience is built** (#738, `apps/web/src/chat/composer.tsx`):
  tap-to-record via `MediaRecorder` → POST `/api/ai/transcriptions` → transcript inserted into the
  composer, **never auto-sent**. Raw audio never leaves the component. (Verified: `composer.tsx:47-50`,
  `:136-141` — the mic **disables with a tooltip** when unavailable, it is not hidden.)
- Backend route `POST /api/ai/transcriptions` exists and executes over direct HTTP with a decrypted
  key (`transcription-routes.ts:57-97`, buffer stays function-local, upstream errors scrubbed): today
  it resolves via `selectModelForCapability("transcription")` then
  `selectProviderWithCredential(model.provider_config_id)`.
- The mic gates on a `transcription` capability route reporting available
  (`lookupAiCapabilityRoute("transcription")`, `composer.tsx:47-50`); its disabled tooltip already
  points at "Settings → Assistant & AI".

**Net:** this task is admin-config + resolver rewiring. No new recorder, no new chat surface.

## Scope (v1)

- **STT only.** No TTS / voice output. Use case is strictly "click a mic and talk instead of typing".
- **Instance-wide, admin-only.** One transcription endpoint for the whole instance; users do not
  configure their own.
- **Config = a single generic OpenAI-compatible STT endpoint:** `base URL` + `API key` + `model name`
  (free text, e.g. `whisper-large-v3`). No vendor catalog, no auto-discovery in v1.

## Data model

Reuse `ai_provider_configs` + `ai_configured_models` so the credential-encryption and HTTP-execution
paths are untouched. Add ONE discriminator so the two surfaces never bleed into each other, plus a
singleton constraint on the voice row.

**Migration (next free AI number — do NOT hardcode. `main` tops at 0145; the Slice-1 branch holds
0147 + 0148 and 0146 is reserved by in-flight #744. Verify the highest committed AI migration at
implementation time, add the `manifest.database.migrations` entry and the `foundation.test.ts`
`toEqual` row. Follow 0147 conventions: `IF NOT EXISTS`, comment header, schema-qualified table.):**

```sql
-- Distinguish a chat/assistant provider from a voice(STT) endpoint so the LLM Providers list and the
-- Voice section render disjoint sets, and so chat resolution / instance-default / per-user pin never
-- pick a voice-only endpoint (and vice versa). Column default backfills every existing row to
-- 'assistant' — a pure DDL default reading no rows, so it is safe under FORCE RLS + the NOBYPASSRLS
-- migration role (same C1 precedent as 0147). See #874 / epic #869.
ALTER TABLE app.ai_provider_configs
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'assistant'
  CHECK (purpose IN ('assistant', 'voice'));

-- Enforce at most ONE voice endpoint instance-wide (HIGH-5). Partial unique index over a constant,
-- mirroring 0147's one-default index. Pure DDL. Prevents two admins / a retried POST from creating
-- rival voice rows whose precedence would then be an unspecified ORDER BY.
CREATE UNIQUE INDEX IF NOT EXISTS ai_provider_configs_one_voice
  ON app.ai_provider_configs ((true)) WHERE purpose = 'voice';
```

- The Voice section creates/edits exactly **one** `purpose = 'voice'` provider row
  (`auth_method = 'api_key'`, `base_url`, `encrypted_credential`) plus **one** `ai_configured_models`
  row carrying the free-text model name with `capabilities` containing `transcription` and
  `status = 'active'`. (Schema note: `ai_configured_models` uses `capabilities text[]` + a `status`
  column — not a scalar `capability`/`active` — match the real columns.)
- No new credential table: the API key is stored in `encrypted_credential` via the same
  `AiSecretCipher` path used for every other API-key provider.

## CRITICAL — the voice provider must never carry active chat models (CRIT-1)

Slice-1's provider-create handler **auto-discovers models on connect** and inserts live-discovered
API models as `status = 'active'` (`packages/ai/src/routes.ts:170-205`, insert at `:197`). Groq's
OpenAI-compatible `/models` returns its full LLM catalog — so a naive "create a provider row for the
voice endpoint" would land active chat-capable models under the voice provider. Every existing
downstream guard filters by **capability only, never provider purpose**
(`capability-route-routes.ts:101-113`, `chat-model-override.ts:56`, worker automatic selection
`repository.ts:877-907`), so chat/summarization traffic — private data — would then execute against
the STT vendor key. This defeats the spec's central guarantee.

**Both halves are required:**

1. **The voice create/update path must NOT run discovery.** Use a dedicated route (below), not the
   generic provider-create handler. Under a `purpose = 'voice'` row, create **only** the single STT
   model row; no other model inserts are permitted.
2. **Add a `providers.purpose = 'assistant'` predicate to every assistant-side model
   selection/validation site**, and `purpose = 'voice'` to the voice lookup. UI filtering alone does
   not meet the security bar. Concrete sites to gate (verify at build time):
   - the `safeModelQuery` join sites feeding capability resolution (`repository.ts`),
   - chat service-binding validation (`capability-route-routes.ts:101-113`),
   - per-user chat override selectable set (`chat-model-override.ts:56`),
   - admin per-user pin validation,
   - worker cross-provider automatic selection (`repository.ts:877-907`),
   - instance-default candidate counting and setter (see HIGH-4).

## Resolver rewiring

- **Transcription gets its own resolver branch** — it must NOT be folded into either the chat path
  or the worker cross-provider branch. Removing `transcription` from `USER_FACING_SERVICES`
  (`repository.ts:205`) without a dedicated branch drops it into the worker branch
  (`repository.ts:766-772`) = cross-provider automatic = exactly the contamination CRIT-1 forbids.
  Add a third branch: transcription resolves to the `purpose = 'voice'` provider's active
  transcription model as an **explicit instance binding**. If no voice endpoint is configured →
  unavailable (no cross-provider fallback; consistent with the Slice-1 "no silent cross-provider
  fallback" rule and the owner's MED-2 ruling that Voice is explicit).
- **Per-user admin pin wins over the voice endpoint (HIGH-3, owner-locked).** Decision #2: an admin
  per-user **provider pin** is a hard constraint on ALL of that user's traffic — chat + voice +
  workers — "private data must stay on the mandated backend" (`repository.ts:693-697`, `:746-763`).
  Therefore for a pinned user, transcription stays inside the pinned provider; a pinned assistant
  provider cannot serve voice, so **the mic goes unavailable for pinned users**, surfaced through the
  existing needs-config / admin-pin-unavailable state — it must NOT silently escape to the instance
  voice endpoint. The transcription special-case must sit **after** the pin check in
  `resolveModelForCapability` (`repository.ts:702-`) so the pin is evaluated first.
- **Chat resolution and the instance-default provider selection consider `purpose = 'assistant'`
  only.** A voice endpoint can never become the chat default, and an assistant provider is never a
  voice source.
- `transcription-routes.ts` switches from `selectModelForCapability("transcription")` to a
  `selectVoiceTranscriptionBinding()`-style lookup scoped to the voice provider (and still honoring
  the per-user pin per above). The rest of the route (direct-HTTP execution, audio-never-persisted
  guarantees) is unchanged.
- `lookupAiCapabilityRoute("transcription")` returns `available` iff a voice endpoint is configured
  and the caller is not pin-blocked, so `composer.tsx`'s `micAvailable` needs no structural change —
  only its backing signal moves.

## Instance-default paths (HIGH-4)

- `resolveDefaultProviderId` auto-default counts **all** active admin-owned providers
  (`repository.ts:649-655`). Scope this count to `purpose = 'assistant'` — otherwise configuring
  voice on a single-provider instance flips the count 1→2, the implicit default disappears, and
  **adding voice causes a chat needs-config outage**.
- `setInstanceDefaultProvider` (`repository.ts:665-688`; route `capability-route-routes.ts:132-158`)
  accepts any visible provider id. It must **reject `purpose = 'voice'`** — otherwise
  `PUT /api/ai/providers/{voiceId}/default` flags the voice row as the instance default and (with the
  discovered-models trap) chat "mode" bindings resolve inside the voice provider.

## UI

- New **Voice** section in the admin AI pane (`apps/web/src/settings/…`), rendered separately from the
  LLM Providers group: `base URL`, `API key` (write-only — masked, never echoed back), `model name`,
  an enable/disable toggle, and a lightweight "test connection" affordance if cheap (optional for v1).
- The LLM Providers list filters to `purpose = 'assistant'` **server-side** (in the query/DTO, not a
  client filter, per the security bar); the Voice section shows the single `purpose = 'voice'` row.
  Neither surface shows the other's rows.

## API surface (HIGH-5 / MED-7)

- **`GET /api/ai/voice-endpoint`** — returns the single voice config (base URL, model name, enabled
  state, whether a key is set). **Never returns the key** (plaintext or ciphertext).
- **`PUT /api/ai/voice-endpoint`** — **upsert** semantics (creates the row if absent, updates in
  place otherwise) so the singleton index can never be tripped by a retried create. Masked-key edit
  rule: **omit-means-keep** — an admin changing only the base URL or model does not re-enter the key;
  a present key field replaces it.
- **Enable/disable** maps to the provider row `status` (and/or the model `status`) — pick one and
  state it; the mic gates off via the capability lookup.
- **Delete** (if offered): hard-delete the voice provider + its model row and destroy the stored
  credential; mic gates off via the lookup.
- All Voice routes `assertInstanceAdmin` / `current_actor_is_admin()`.

## Singleton ownership & recovery (MED-6)

The admin-owned row is visible to all users only while `app.owner_is_active_admin(owner_user_id)`
holds (`0091_chat_model_override.sql:35-45`). If the creating admin is later deactivated/demoted, the
one voice row goes invisible to every user and the mic dies silently — and the singleton index would
then block a replacement INSERT for a row no one can see. Define ownership explicitly:

- On every voice `PUT`, **(re)assign `owner_user_id` to the acting admin** so the row's visibility
  always tracks a currently-active admin (mirrors the wedged-default recovery 0147 solved with its
  blind clear). Any admin may edit the single voice row.

## Supersede the Slice-1 Voice service row (in-pass, no half-retirement) (HIGH-2)

Slice 1 (#870) set `BINDABLE_SERVICES = chat + transcription` and rendered a Voice row in the
Services group. This task:

- Sets `BINDABLE_SERVICES` back to **chat only**; removes the Voice row from the Services group
  (`settings-ai-admin-pane.tsx:96`).
- **Drops** any Slice-1 transcription service binding outright rather than reading it through — every
  such binding necessarily points at a model under a `purpose='assistant'` row (the column default
  backfills all pre-existing rows to `'assistant'`), which would violate invariant (e) below. Slice 1
  barely landed; real-world transcription bindings ≈ 0. The mic simply shows unavailable until the
  admin fills the Voice section. Same ruling covers the older
  `ai.capability_routes["transcription"]` legacy read-through (`repository.ts:568-591`).
- Removes now-dead Slice-1 Voice-binding vocabulary in the same pass (no stale concepts left behind).

## Stale-concept sweep (MED-8 — enumerate, don't leave half-retired)

- `BINDABLE_SERVICES` → chat only (above).
- `USER_FACING_SERVICES` (`repository.ts:205`): do NOT naively drop `transcription` — give it the
  dedicated resolver branch (see Resolver rewiring) so it does not fall into the worker branch.
- `PUT /api/ai/services/transcription/binding` + the GET service-bindings loop + the schema enum
  `["chat","transcription"]` (`packages/shared/src/ai-api.ts:196`) → back to chat only.
- The Voice service row in `settings-ai-admin-pane.tsx:96`.
- Slice-1 H4 transcription **inference** in `model-discovery.ts:214-235`: under this design assistant
  providers can never serve voice, so whisper models discovered under assistant providers become
  unbindable dead weight. Decide keep-or-revert **in-pass** (recommend: stop inferring `transcription`
  on assistant-provider discovery — it can no longer be bound).
- Orphaned `ai.service_bindings.transcription` JSON key: harmless (the parser drops unknown keys);
  note only, no SQL delete (RLS forbids the data migration anyway).

## Security

- API key masked/write-only in every DTO — GET never returns the plaintext or ciphertext (assert in a
  test, matching the Slice-1 no-credential-leak test).
- All Voice mutations `assertInstanceAdmin` / `current_actor_is_admin()` — instance config, admin-only.
- `purpose` gating is enforced in the **resolver and the queries**, not just the UI (CRIT-1), so a
  voice endpoint can never be selected for chat by any code path and vice versa.
- The per-user admin pin is honored for voice (HIGH-3) — audio never routes to a backend the admin
  walled a user off from.

## Migration & test invariants

- Two pure-DDL statements in one migration (the `purpose` column + the one-voice partial unique
  index). No data migration (FORCE RLS + NOBYPASSRLS role).
- Add the migration row to `foundation.test.ts` (`toEqual` full list) and the manifest; run the full
  integration suite.
- Tests:
  - (a) save round-trips base URL + model name; key never returned; omit-means-keep leaves the stored
    key intact.
  - (b) transcription resolves against the voice binding for an un-pinned user.
  - (c) no voice endpoint → transcription unavailable; mic **disabled with tooltip** (not hidden).
  - (d) a voice endpoint is excluded from chat resolution AND from the instance-default candidate set;
    `setInstanceDefaultProvider` rejects a `purpose='voice'` id.
  - (e) an `assistant` provider is never used as a voice source; the voice provider never gains an
    active chat model (CRIT-1 — assert the voice create path runs no discovery).
  - (f) a pinned user's transcription stays inside the pinned provider → mic unavailable, does not
    escape to the instance voice endpoint (HIGH-3).
  - (g) two voice `PUT`s / a retried create → still exactly one voice row (singleton index).
  - Stub `fetch`/the STT call in any test that would otherwise hit a live endpoint.

## Non-goals

- TTS / spoken replies.
- Per-user transcription config.
- STT vendor catalog / model auto-discovery (later enhancement; the generic endpoint is the escape
  hatch).
- Any change to the mic UX itself (shipped in #738).
