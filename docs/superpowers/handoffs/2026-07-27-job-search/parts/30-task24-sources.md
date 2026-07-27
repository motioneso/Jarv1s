## Appended — Task 24: user-added job board sources (dynamic fetch-host grants)

Appended after the plan was approved, on Ben's 2026-07-27 ruling that custom sources are in v1
(#1309). Task numbering is frozen, so this lands here rather than folded into an earlier task. Per
ledger N14, this part is the required plan gate — no Task 24 code exists before this is reviewed and
approved, and it carries contracts and invariants, not an implementation.

**Where the issue body and a ruling disagree, the ledger wins (N11).** No conflict was found between
the issue body and the ledger while writing this part; both agree the security posture here is
deliberately light and reuses `assertValidFetchHosts` rather than building new machinery (ledger
lines 594–601, issue body "Security posture" section).

**Depends on:** Task 5 (`Posting`, `FailureCause`, `describeFailure`, `FailureKind` — closed at five
members, Task 24 does not add a sixth), Task 11 (`Portal`, `FetchLike`, `CrawlResult`, `statusToKind`,
`PAGE_CAP`), Task 13 (`JobSearchStore`, `validateProfileInput`, `stripEnvelope` — Task 24 adds four
methods to the closed interface, per Task 13's own rule: "If a later task needs one, it is added
here first, with its own test, in the same change"), Task 16 (`job-search.portal.set-enabled`,
`job-search.portal.list` — reused unchanged for enabling/disabling/listing a custom source; Task 24
adds no new enable/disable/list tool).

**Files**

- Create: `external-modules/job-search/sql/0008_create_job_search_custom_sources.sql`
- Create: `external-modules/job-search/src/adapters/custom.ts` — the `Portal` implementation for a
  user-named source
- Create: `external-modules/job-search/src/worker/handlers/source.ts` — `source.add`, `source.remove`
- Modify: `external-modules/job-search/src/domain/store-port.ts` — add `CustomSource` and the four
  new `JobSearchStore` methods below
- Modify: `external-modules/job-search/jarvis.module.json` — two more tools
- Modify: `packages/module-registry/src/external/worker-rpc-host.ts` — the `fetch.request` branch's
  host list becomes `manifest.fetchHosts` **∪** the actor's granted hosts
- Test: `tests/unit/job-search-adapter-custom.test.ts`
- Test: `tests/unit/job-search-source-handler.test.ts`
- Test additions: `tests/integration/module-worker-rpc.test.ts` — the merged-host case at the
  platform boundary (this is the one file every external module's `fetch.request` calls go through;
  it is not job-search-specific, and the new cases belong there, not in a job-search test)

**Contracts**

```sql
-- 0008_create_job_search_custom_sources.sql
-- A user-named job board, registered conversationally. This is the grant AND the definition: the
-- row's existence is what makes `host` fetchable for this owner (see worker-rpc-host.ts), and its
-- host/label/url are what turns it into an ordinary Portal at crawl time — a custom source is not a
-- second code path, it is one more row `listPortals` can join against.
CREATE TABLE app.job_search_custom_sources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL,
  -- Lowercase, no port, no IP literal — the exact shape `isPinnableHost` already requires
  -- (`packages/host-fetch/src/policy.ts:1`). Re-validated at the RPC boundary on every fetch
  -- regardless of what's stored here; this column is not the only place the invariant is checked.
  host          text NOT NULL,
  label         text NOT NULL,
  -- The page the adapter fetches. Always https (enforced at registration AND, independently,
  -- by createHostPinnedFetch itself, which rejects a non-https URL at request time).
  url           text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- Composite FK safety (see app.job_search_profiles's own comment): a single-column
  -- `profile_id REFERENCES … (id)` would let a row owned by A hang off a profile owned by B.
  UNIQUE (owner_user_id, id),
  UNIQUE (owner_user_id, profile_id, host),
  FOREIGN KEY (owner_user_id, profile_id)
    REFERENCES app.job_search_profiles (owner_user_id, id) ON DELETE CASCADE
);
```

```ts
// domain/store-port.ts additions — the closed JobSearchStore interface gains exactly these four
// methods. No existing method's signature changes; listPortals(profileId) is untouched (see
// Constraints — label/host resolution for a custom source happens in the Task 16 handler, not here).
export interface CustomSource {
  readonly id: string;
  /** "custom:" + id. The join key into app.job_search_portals — that table's schema does not
   * change; a custom source's health row is written and read exactly like a built-in portal's. */
  readonly sourceId: string;
  readonly host: string;
  readonly label: string;
  readonly url: string;
  readonly createdAt: string;
}

// Added to JobSearchStore (Task 13, external-modules/job-search/src/domain/store-port.ts):
listCustomSources(profileId: string): Promise<CustomSource[]>;
addCustomSource(profileId: string, url: string, label: string): Promise<CustomSource>;
removeCustomSource(profileId: string, sourceId: string): Promise<void>;
/** Every host currently granted to THIS OWNER across all of their profiles — the union
 * worker-rpc-host.ts's `fetch.request` branch computes before calling createHostPinnedFetch.
 * Owner-scoped, not profile-scoped: see Constraints for why the RPC boundary can only ever
 * scope by actor, never by profile. */
listGrantedHosts(): Promise<string[]>;
```

```ts
// adapters/custom.ts
/** One Portal per registered custom source. Fetches exactly the registered `url` once — there
 * is no discoverable pagination contract for an arbitrary site, so unlike freehire's PAGE_CAP
 * loop, this adapter makes one request per crawl and lets Task 6/8 narrow whatever comes back. */
export function customPortal(source: { id: string; label: string; host: string; url: string }): Portal;
```

```ts
// worker/handlers/source.ts
export const SOURCE_ADD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["profileId", "url"],
  properties: {
    profileId: { type: "string" },
    url: { type: "string" },
    label: { type: "string" }
  }
} as const;

export const SOURCE_REMOVE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["profileId", "sourceId"],
  properties: {
    profileId: { type: "string" },
    sourceId: { type: "string" }
  }
} as const;
```

```ts
// worker-rpc-host.ts — fetch.request branch, the only change
const hosts = [
  ...(input.module.manifest.fetchHosts ?? []),
  ...(await input.workerDataContext.withDataContext(
    { actorUserId: input.actorUserId, requestId: input.requestId },
    (scopedDb) => grantedHostsFor(scopedDb) // module-specific; job-search's is listGrantedHosts()
  ))
];
if (!hosts.length) throw new ExternalModuleRpcError("invalid_rpc");
```

**Constraints**

- **The grant is owner-scoped, not profile-scoped, and that is a consequence of the existing
  enforcement point, not a new design choice.** `fetch.request` (`worker-rpc-host.ts:213` today) has
  `input.actorUserId` and `input.module`, and nothing else — no `profileId` travels with a raw fetch
  call. Adding a host under Profile A therefore makes that host fetchable for **any** of that same
  owner's profiles, not just the one it was registered under. It never crosses to another user. This
  is a real, user-visible consequence worth restating in the settings/board copy (Task 20), not a
  security gap — the isolation boundary here is the owner, same as every other table in this module.
- **Reuse, don't rebuild, the host check.** `isPinnableHost`/`assertValidFetchHosts`
  (`packages/host-fetch/src/policy.ts:1,6`) are the only validation this task adds at the RPC
  boundary; `createHostPinnedFetch` already runs `assertValidFetchHosts` internally on the merged
  list before every request (`packages/host-fetch/src/index.ts`), and its existing `BLOCKED`
  loopback/link-local/RFC1918/cloud-metadata subnet list and DNS-pinning apply to a granted host
  exactly as they do to `freehire.me` — nothing about that machinery is custom-source-aware and
  nothing here should make it so. Per Ben's ruling (ledger lines 594–601): no new security machinery.
- **`source.add` validates before it ever reaches storage or the fetch layer**, so a bad URL is a
  clear tool-call error instead of a confusing first-crawl failure later: `new URL(url)` must not
  throw; `protocol` must be `"https:"`; `hostname.toLowerCase()` must satisfy `isPinnableHost`. All
  three throw, matching `parseContextSummary`'s house rule that a bad value throws at the boundary
  rather than reaching a screen or a crawl.
- **A host already covered by `jarvis.module.json`'s static `fetchHosts` is rejected at
  registration** (`"linkedin.com already has a built-in source"`-style error) — a custom source
  shadowing a built-in adapter would get the built-in's worse, unstructured extraction instead of
  its real parser, for no benefit.
- **`source.add` never enqueues**, matching Task 16 test 1's rule for `criteria.set`: a handler
  cannot enqueue, and the source is picked up on this profile's next scheduled or triggered crawl —
  there is nothing here for it to enqueue *to* that isn't already the ordinary crawl path.
- **`source.remove` only removes a `custom:`-prefixed source.** A built-in portal (`freehire`,
  `linkedin`) has no row in `job_search_custom_sources` to delete; `source.remove` against a
  non-`custom:` id throws rather than silently no-op-ing, so a caller cannot mistake "nothing
  happened" for "removed." Disabling a built-in stays `job-search.portal.set-enabled`, unchanged.
- **No cross-table transaction.** `ctx.db.query` allows no `BEGIN` (Task 13's constraint 1).
  `removeCustomSource` therefore deletes the `job_search_custom_sources` row first — that row is the
  one thing that makes a source exist — and best-effort deletes its `job_search_portals` health row
  second. If the process dies between the two statements, the leftover health row is inert: Task
  16's `portal.list` merge only shows a `custom:` source_id that still has a matching
  `job_search_custom_sources` row, so an orphaned health row is invisible cruft, not a phantom
  portal, and a later crawl of a real custom source can never collide with a stale id (`gen_random_uuid`
  is not reused).
- **Label/host resolution for `portal.list` (Task 16, part 21) needs one addition, flagged here
  because part 21 predates Task 24 and does not mention custom sources:** `listPortals(profileId)`
  itself is unchanged (still `Promise<PortalState[]>`, sourced from `job_search_portals` only, no
  label). The `portal.ts` handler resolves `label`/`host` for a `custom:` id from
  `store.listCustomSources(profileId)` the same call already has to make for the merge, exactly the
  way it presumably already resolves `freehire`/`linkedin`'s label from a static built-in registry.
  A profile with an unrecognized state — active but never crawled — has the identical "no health row
  yet" situation for a brand-new custom source as it does for a brand-new built-in one; this is not
  a new problem, so this part does not attempt to solve it.
- **`parse_failed` and `login_required` are identical to every built-in portal, not a lighter
  version.** `customPortal(...).crawl` maps its response status through Task 11's own
  `statusToKind`, so 401/403 disables the source exactly like `describeFailure("login_required", …)`
  already does for freehire/LinkedIn — the crawler never signs in and never uses stored credentials
  against any job board, custom or built-in. An unrecognized or unparseable page is `parse_failed`
  with `disabled: true`, never an empty result set that reads as "nothing matched" (same rule Task 11
  states for freehire's unrecognized envelope).
- **The extraction step is the one place in this part I designed rather than found — flagged
  explicitly, see the note to team-lead below.** An arbitrary job board page has no known schema, so
  `customPortal`'s `crawl` fetches the one registered `url`, then calls `ctx.ai.generateStructured`
  with a JSON Schema shaped like `Posting` minus `id`/`sourceId` (Task 11's `id: ""` convention: the
  adapter never invents an id), in the same envelope-checked, capability-routed shape Task 9's
  `SCORE_SCHEMA` and Task 10's `CRITERIA_SCHEMA` already use — no provider or model is named here,
  satisfying the provider-agnostic-AI invariant by construction. The result is run through a strict
  parser in the same house style as `parseCriteria`: unknown keys rejected, no field defaulted to
  invented content. A `generateStructured` call that itself fails (a bad envelope, not a bad page) is
  `parse_failed`, not a sixth `FailureKind` — `FailureKind` stays closed at five members.
- **No pagination.** One fetch per crawl. Task 6 (dedupe/excludes) and Task 8 (triage) already
  over-fetch and narrow; a custom source is not exempt from that pattern, it is simply single-page.

**Tests** (`tests/unit/job-search-adapter-custom.test.ts`)

1. **Fetches exactly the registered `url` once**, never a derived or guessed path — fails against an
   adapter that tries `/jobs` or `/api/jobs` heuristics on the host.
2. **A well-formed extraction maps onto `Posting` records** with `id === ""`, `sourceId` equal to the
   source's own `sourceId`, and every other field non-empty — same shape assertion as freehire's
   test 1, for the same reason (catches a field silently populated from the wrong place).
3. **401/403 → `login_required`, disables itself** — identical assertion to freehire's test 4,
   proving the custom adapter is not a lighter-security second path.
4. **An extraction that fails its own strict parser (unknown key, wrong type) → `parse_failed`,
   `disabled: true`, zero postings** — never a partial guess at what the model meant.
5. **A `generateStructured` envelope failure (e.g. `needs_config`) → `parse_failed`**, not a thrown
   error out of `crawl` and not a sixth `FailureKind`.
6. **Deadline already passed → fetches nothing**, matching freehire's test 8 (Task 11's `Portal`
   contract is symmetric across every implementation of it).

**Tests** (`tests/unit/job-search-source-handler.test.ts`)

1. **`source.add` rejects a non-https URL, an unparseable URL, and an IP-literal or uppercase host**
   — three separate assertions, each naming which check failed rather than one generic error.
2. **`source.add` rejects a host already in `jarvis.module.json`'s static `fetchHosts`.**
3. **`source.add` returns a record whose `sourceId` starts with `"custom:"`** and never enqueues
   anything (assert the fake queue-enqueue spy, if the test harness has one, is never called — same
   pattern as Task 16 test 1's absence assertion).
4. **`source.remove` against a non-`custom:` sourceId throws** rather than silently doing nothing.
5. **`source.remove` deletes the custom source such that a second `listCustomSources` no longer
   includes it**, even if its `job_search_portals` health row is left in place by a simulated
   mid-operation failure — the orphan must not resurface as a phantom listing.
6. **Every handler strips `actorUserId` via `stripEnvelope`/`validateProfileInput`** and rejects a
   genuinely unknown key, matching Task 16 test 6's rule for this module's other handlers.

**Tests** (`tests/integration/module-worker-rpc.test.ts` additions)

1. **A `fetch.request` for a host present only in a caller-scoped grant (not in
   `manifest.fetchHosts`) succeeds** when the grant lookup returns that host, and **fails with
   `host_not_declared`** when it does not — proving the merge is additive, not a replacement of the
   manifest list.
2. **Two different actors' grants never leak into each other's `fetch.request` calls** — actor A's
   granted host is unreachable through actor B's invocation even when both call the same module's
   `fetch.request` in the same test run. This is the one assertion this task cannot skip: it is the
   direct test of the "owner-scoped, not global" claim in Constraints.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-adapter-custom.test.ts tests/unit/job-search-source-handler.test.ts \
  && pnpm test:integration tests/integration/module-worker-rpc.test.ts \
  && pnpm check:external-modules   # exit 0 for all three
```
