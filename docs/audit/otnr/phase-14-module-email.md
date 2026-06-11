## Phase 14 — Module email

### CRIT / HIGH / MED / LOW / INFO counts

- CRIT: 0
- HIGH: 0
- MED: 3
- LOW: 4
- INFO: 3

### Findings

#### [MED] Blanket catch maps every route error to 401 "Session is missing or expired"
**File:** `packages/email/src/routes.ts:89-91`  
**Invariant violated / concern:** Quality smell — swallowed/misclassified errors; leaked-as-wrong-status; divergence from the canonical handler. Touches review dimension E (error handling).  
**Detail:** `handleRouteError(_error, reply)` ignores its `_error` argument entirely and returns `401 "Session is missing or expired"` for *every* failure in both GET handlers. A Postgres outage, an RLS denial, a serialization bug, a Kysely query error, or any programming exception is all reported to the client as an expired session. The canonical sibling handler in `packages/tasks/src/routes.ts:598-610` discriminates: it maps `HttpError` to its status, maps the two known auth-message strings to 401, and `throw error`s everything else so Fastify's error handler produces a real 500 (and logs it). The email module (and its copy in `packages/calendar/src/routes.ts:89-90`) silently lost that behavior. Result: genuine 500-class failures are invisible in monitoring, and clients are told to re-authenticate when the real problem is server-side. This also means the module never surfaces a 500, which is misleading for operators.  
**Suggested fix:** Adopt the tasks-module handler shape: re-throw unknown errors so the framework returns/logs a 500, and only translate the known auth sentinels to 401. Better: extract one shared `handleAuthRouteError` helper (e.g. in `@jarv1s/module-sdk`) and have email/calendar/tasks all import it, deleting the three divergent copies (code-judo — collapses three near-duplicate handlers into one).

#### [MED] `externalMetadata` passed verbatim to API responses and AI tool output with no allowlist
**File:** `packages/email/src/routes.ts:79`, `packages/email/src/tools.ts:16`  
**Invariant violated / concern:** Hard invariant 5 (Secrets never escape — must not reach frontend responses or AI prompts) — latent/forward-looking exposure surface.  
**Detail:** `serializeEmailMessage` copies `message.external_metadata` (typed `Record<string, unknown>`, schema `additionalProperties: true`) straight into the `EmailMessageDto` returned to the browser and into the `email.listVisibleMessages` assistant-tool result (`tools.ts` calls the same serializer). The DB CHECK only enforces `jsonb_typeof = 'object'`; nothing constrains the keys. Today no connector-sync writer populates this column (only `createCachedMessageForTest` does), so there is no live leak — but the contract is an open passthrough. When real email sync lands (a separate milestone), whatever the provider returns — message-ID headers, raw provider tokens, internal routing fields, thread credentials — flows unfiltered to the frontend and, via the assistant tool, potentially into an AI prompt. The opaque `Record<string, unknown>` obscures the real invariant (that this field must contain only non-sensitive provenance metadata).  
**Suggested fix:** Define an explicit, narrow metadata shape (named fields) or strip `external_metadata` from the serializer output (and from the tool result specifically). At minimum, gate the assistant-tool serialization through a separate projection that omits `externalMetadata`, and document that connector sync must allowlist keys before persisting. Do this before the sync milestone, not after.

#### [MED] No XSS/sanitization boundary or test for `subject`/`snippet`/`bodyExcerpt` rendered content
**File:** `packages/email/sql/0012_email_module.sql:5-9`, `packages/email/src/routes.ts:74-76`  
**Invariant violated / concern:** Review dimension A (XSS on rendered email-derived content) — missing boundary validation.  
**Detail:** `sender`, `subject`, `snippet`, and `body_excerpt` originate from untrusted email content and are stored and serialized as raw `text` with no sanitization or stripping at the persistence or serialization layer. The module is a read cache, so the safety guarantee is entirely deferred to whatever renders the DTO. There is no test asserting that script/HTML payloads in these fields are escaped or stripped, and no comment marking the rendering contract (React auto-escapes text nodes, but any future `dangerouslySetInnerHTML`, link autodetection on `sender`, or markdown rendering of `bodyExcerpt` would be an injection sink). For a module whose entire input domain is attacker-controlled email, the absence of an explicit "these fields are untrusted, render as inert text only" contract is a real gap.  
**Suggested fix:** Document the render contract in the DTO / module (untrusted, plain-text only) and add an integration or e2e assertion that an email with an HTML/script payload in subject/body is rendered inert. If any HTML rendering is ever intended, route it through a sanitizer at a defined boundary, never raw.

#### [LOW] `getById` performs no existence/ownership filter — relies solely on RLS to 404
**File:** `packages/email/src/repository.ts:32-40`, `packages/email/src/routes.ts:55-57`  
**Invariant violated / concern:** Review dimension A/G — defense-in-depth and IDOR clarity.  
**Detail:** `getById` selects by `id` only; cross-user isolation depends entirely on the `email_messages_select` RLS policy filtering the row out so `executeTakeFirst()` returns `undefined` and the route 404s. This is correct given FORCE RLS (verified in `0012`/`0021`), so it is not a hole — but the repository expresses no owner intent, and the only thing standing between a guessed UUID and a private message is the policy. The `calendar-email.test.ts` suite does cover cross-user/admin hiding and share-based reads, which is what makes this LOW rather than higher.  
**Suggested fix:** Keep RLS as the enforcement layer (correct), but add a one-line comment in `getById` stating that visibility is enforced by RLS, so a future reader doesn't add a "missing" owner filter or, worse, switch to a root handle. Optionally assert the 404-on-other-user path at the route/HTTP level (current tests assert at the repository level).

#### [LOW] `createCachedMessageForTest` is production code that exists only for tests
**File:** `packages/email/src/repository.ts:42-69`  
**Invariant violated / concern:** Quality smell — test-only API leaking into the shipped repository surface; dead/incidental production code.  
**Detail:** The repository's only write path is `createCachedMessageForTest`, exported as part of the public `EmailRepository` and re-exported from `index.ts`. It is the sole INSERT into `email_messages` anywhere in the codebase (no real sync writer exists yet). A test-only mutator on the production repository invites accidental production use and muddies the module's real surface (read-only cache). The name flags intent, but it is still shipped in the package's public API.  
**Suggested fix:** Move the test-insert helper into the integration test support layer (a test fixture/factory) rather than the production `EmailRepository`, or clearly fence it. When the real connector-sync writer arrives, fold the insert into that path and delete the `*ForTest` method.

#### [LOW] INSERT policy uses `app.current_actor_user_id()` for `owner_user_id` but trigger doesn't validate it matches at insert time
**File:** `packages/email/src/repository.ts:55`, `packages/email/sql/0012_email_module.sql:31-49`  
**Invariant violated / concern:** Review dimension B — implicit coupling between app code and RLS.  
**Detail:** The repository sets `owner_user_id: sql\`app.current_actor_user_id()\``, and the INSERT `WITH CHECK` independently requires `owner_user_id = app.current_actor_user_id()`. This is belt-and-suspenders and correct, but the app-side `sql<string>\`app.current_actor_user_id()\`` literal embedded in the insert values is a subtle coupling: the column value is computed in SQL, not in TS, so the TS type is a lie (`sql<string>` asserts a string the runtime never produces in JS). It works, but it's the kind of cast-heavy contract the standards flag.  
**Suggested fix:** Acceptable as-is given RLS double-checks it, but prefer resolving `actorUserId` from the `AccessContext`/scoped handle and passing a real value, so the TS type reflects reality and the insert isn't dependent on a SQL function call evaluating identically to the policy.

#### [LOW] `connector_account_id` exposed in DTO without a clear consumer
**File:** `packages/email/src/routes.ts:70`, `packages/shared/src/email-api.ts:3`  
**Invariant violated / concern:** Quality smell — over-broad contract; minor information exposure.  
**Detail:** `connectorAccountId` is surfaced in the frontend DTO. It is an internal join key to `app.connector_accounts`; exposing it to the browser leaks the existence/identity of a connector-account UUID with no apparent UI consumer. Not a secret (it's not a credential), but it widens the contract beyond what the read surface needs.  
**Suggested fix:** Drop `connectorAccountId` from the DTO unless a concrete frontend consumer needs it; keep it server-side only.

#### [INFO] RLS reviewed — owner-or-share model is correctly wired and FORCE RLS is on
**File:** `packages/email/sql/0021_email_owner_or_share.sql:10-57`, `packages/email/sql/0012_email_module.sql:59-62`  
**Invariant violated / concern:** Hard invariants 1 & 2 (no admin bypass; private by default) — verified clean.  
**Detail:** `email_messages` has `ENABLE` + `FORCE ROW LEVEL SECURITY`; only `jarvis_app_runtime` is granted SELECT/INSERT/UPDATE (no worker grant, no `BYPASSRLS`). SELECT is owner-or-`has_share('email_message', id, 'view')`; UPDATE requires owner-or-`'manage'` on both USING and WITH CHECK; INSERT requires owner identity plus an EXISTS proving the connector account is owned by the actor and is of `provider_type = 'email'`. The generic `app.shares` model (verified in `infra/postgres/migrations/0017_shares.sql`) needs no per-type registration, and `has_share` enforces a `share_level_rank` hierarchy. `calendar-email.test.ts` exercises private-hiding, admin-hiding, owner-or-share read, and the workspace-membership-is-insufficient case. This is a correct, tight implementation.

#### [INFO] No DELETE policy/grant — rows are immutable-except-update and cascade-delete only
**File:** `packages/email/sql/0012_email_module.sql:59`  
**Invariant violated / concern:** Informational — intentional design, reviewed.  
**Detail:** Only SELECT/INSERT/UPDATE are granted to `jarvis_app_runtime`; there is no DELETE grant or policy. Rows are removed only via `ON DELETE CASCADE` from `connector_accounts`/`users`. Combined with the identity-change trigger (`prevent_email_message_identity_change`) protecting `owner_user_id`, `connector_account_id`, `external_id`, and `created_at`, the table is an append-and-refresh cache with no app-driven deletion. This is a coherent design for a connector cache; flagged only so reviewers know the omission is intentional, not a gap.

#### [INFO] No VaultContext / raw-fs / SMTP-IMAP-credential surface in this module
**File:** `packages/email/src/` (whole module)  
**Invariant violated / concern:** Hard invariants 3 & 5 — reviewed, not applicable here.  
**Detail:** The module-specific focus areas around email credentials, SMTP/IMAP secrets, attachment handling, and path traversal do not apply: this module is a read-only cache of message *metadata/excerpts* over `DataContextDb` only. There is no `fs` usage, no `VaultContext` need, no attachment storage/download path, and no SMTP/IMAP credential handling anywhere in `packages/email/src`. Connector credentials live in the connector module and are out of scope here. Confirmed clean for those dimensions. (Note: the credential-encryption and attachment concerns will become live in the future real-sync milestone — see the MED finding on `externalMetadata`.)
