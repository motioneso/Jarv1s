# Brave Search API key — admin UI + encrypted instance setting

**Status:** Draft — awaiting approval
**Date:** 2026-06-23
**Owner:** Ben
**GitHub:** closes #446 (Part of #382)
**Grounded on:** `origin/main` @ `96b83d0f` (local `main`, source tree unchanged)

---

## Goal

Let an admin set / rotate / revoke the Brave Search API key from Settings — no env-file edit, no
stack restart — with the key **AES-256-GCM encrypted at rest** and never exposed to the frontend.

Success = Admin Settings shows a Web Search row; pasting a key saves it encrypted; chat web search
starts working without a restart; `GET` returns only `{ configured: boolean }`; env var still works
as a fallback for existing installs; `pnpm verify:foundation` green.

This is the right-sized fix for the deployed reality (Brave provider via
`JARVIS_BRAVE_SEARCH_API_KEY` in `packages/web-research`). It does **not** build the larger
per-user FireCrawl/DuckDuckGo module described in `2026-06-22-web-search.md` — that remains a
separate future initiative; this instance-wide admin key is compatible with it (would act as the
instance default/fallback).

---

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Scope = instance-wide admin key**, not per-user. Mirrors the process-wide env var it replaces; matches issue #446 ("instance setting").                                                                                                                                                                                                                                                                                                                                                                                    |
| D2  | **Storage = AES-256-GCM `EncryptedSecret` envelope stored as the existing `instance_settings.value` jsonb.** No migration, no new column. Encrypted with the shared `JsonSecretCipher` bound to a new domain label, keyed by `JARVIS_AI_SECRET_KEY` (already a required deploy secret). Honors the "encrypted at rest, never plaintext" requirement that motivated the connector-vault choice, while keeping the semantically-correct home for an instance-wide secret. **← the one point to confirm (see Reconciliation).** |
| D3  | **Read precedence at use:** instance setting (decrypted) first, `JARVIS_BRAVE_SEARCH_API_KEY` env second. Zero-downtime migration for existing installs.                                                                                                                                                                                                                                                                                                                                                                     |
| D4  | **Decrypt-at-use, not at module load.** `getDefaultWebSearchProvider()` resolves the key per request (so a freshly-saved key takes effect without restart), with a short in-process cache invalidated on save/revoke.                                                                                                                                                                                                                                                                                                        |
| D5  | **Dedicated encrypted routes.** Generic `POST /api/admin/settings/:key` is hardened to **reject** any `secret:true` registry key, so the secret can never be written as plaintext jsonb through the generic path.                                                                                                                                                                                                                                                                                                            |

### Reconciliation with the earlier "connector vault" decision

The prior AskUserQuestion answer chose "connector vault (AES-256-GCM)" **over "instance_settings
(plaintext)"** — i.e. the driver was _encrypted, never plaintext_. D2 stores an AES-256-GCM
envelope (same `JsonSecretCipher` family as connector/AI secrets) in the `instance_settings.value`
jsonb — so it is **not** the plaintext path that was rejected. The connector vault proper is
per-user / per-connector (RLS-scoped) and is an awkward home for an instance-wide admin secret.
**If you'd rather still use a connector-style table, say so and I'll switch D2** — otherwise the
encrypted-envelope-in-instance_settings path is recommended.

---

## Backend

### 1. Registry (`packages/settings/src/instance-settings-keys.ts`)

Add `{ key: "web.brave_search_api_key", secret: true }` to `INSTANCE_SETTINGS_REGISTRY`. The
existing list route already filters out `secret:true` keys, so it never appears in
`GET /api/admin/settings`.

### 2. Cipher (`packages/settings/src/...` — small new helper, or reuse `@jarv1s/db`)

Use the shared `JsonSecretCipher` from `@jarv1s/db` with domain label `"web search secret"`,
resolved from `JARVIS_AI_SECRET_KEY` (same keyring helper as `packages/ai/src/crypto.ts`). Encrypt
the raw key → `EncryptedSecret` JSON; store as `value: { value: <EncryptedSecret> }` via the
existing `upsertInstanceSetting` (matches the `{value:…}` wrapper convention).

### 3. Routes (`packages/settings/src/routes.ts`, admin-guarded via `assertAdminUser`)

- `GET /api/admin/settings/web-search` → `{ configured: boolean, source: "instance" | "env" | null }`.
  Never returns the key or ciphertext.
- `PUT /api/admin/settings/web-search` `{ apiKey: string }` → validates non-empty, encrypts,
  upserts, invalidates the provider cache. Returns `{ configured: true }`.
- `DELETE /api/admin/settings/web-search` → deletes the instance row (falls back to env or
  unavailable), invalidates cache. Returns `{ configured: <env-present> , source }`.
- Harden the generic `POST /api/admin/settings/:key`: reject keys whose registry entry is
  `secret:true` (400), forcing the encrypted path.

### 4. Provider resolution (`packages/web-research/src/providers.ts`)

`getDefaultWebSearchProvider()` becomes async-resolved at request time (or backed by a
`refreshWebSearchKey()` the save/revoke routes call): decrypt instance setting → key; else env
key; else `unavailableSearchProvider`. Keep `setWebSearchProviderForTests` seam. The module must
not import `@jarv1s/db`/settings internals directly — resolve the key via a small injected
accessor passed from the composition root (module isolation).

### Invariants (hard)

- Key never in frontend responses, logs, pg-boss payloads, AI prompts, or exports — `GET` returns
  `{ configured }` only.
- AES-256-GCM at rest; plaintext key never written to `instance_settings.value`.
- Admin-only on all three routes (`assertAdminUser`).
- No edits to applied migrations; no new infra migration (none needed).

---

## Frontend

- New **Web Search** row in the AI admin pane (extract to an "Integrations" pane only if the AI
  pane nears the 1000-line gate).
- `GET /api/admin/settings/web-search` → `{ configured }`.
- Configured: "Brave Search — configured" + source chip (`env` shows "set via environment") +
  Revoke (disabled when `source==="env"`, with tooltip "set in environment; edit env to change").
- Not configured: masked password input + Save + link to https://brave.com/search/api/.
- Save/Revoke pattern mirrors existing AI provider key fields. No placeholder data; `NotWired`→wired.

---

## Tests

- **Unit (`packages/web-research`)**: key precedence (instance > env > unavailable); cache refresh
  after save/revoke; provider stays `unavailable` with no key.
- **Integration (`tests/integration/settings*.test.ts` or new `web-search-key.test.ts`)**:
  PUT encrypts (DB row is ciphertext, not the raw key); GET returns `{ configured }` only and never
  the key/ciphertext; non-admin gets 403; generic `POST /api/admin/settings/web.brave_search_api_key`
  is rejected; DELETE falls back to env.
- **e2e (optional)**: Settings row save → configured state.

---

## Out of scope

- Per-user search provider configs / FireCrawl / DuckDuckGo (the `2026-06-22-web-search.md` module).
- SSRF / rate-limit / trust-boundary bundle (#358/#359/#360) — tracked by that spec.
- Key validation against Brave's API on save (just store; chat surfaces a real failure if invalid).

---

## Acceptance criteria (from #446)

- [ ] Admin can paste a Brave key in Settings and save without editing env files or restarting.
- [ ] Key is encrypted at rest; GET returns only `{ configured }`.
- [ ] Env var still works as a fallback for existing installs.
- [ ] Revoke clears the instance setting (falls back to env or unavailable).
- [ ] Generic instance-settings upsert rejects `secret:true` keys.
- [ ] `pnpm verify:foundation` green; #446 closed.
