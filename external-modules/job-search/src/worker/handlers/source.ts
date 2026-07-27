// external-modules/job-search/src/worker/handlers/source.ts
//
// Task 24 (#1309): job-search.source.add and job-search.source.remove — user-named job board
// sources, registered conversationally. Same four-step shape as profile.ts/portal.ts: validate
// the input, call the store, shape a record, return it. The one thing neither of those files
// does is write a platform capability alongside the store call — the fetch-host grant — which is
// why this file also owns the kv.set/kv.delete calls (ledger N17/N18: no new port, no new RPC
// branch, `ctx.kv` already exists and the grant is platform-owned `app.module_kv`, not a
// job-search table).
import type { ModuleWorkerContext } from "@jarv1s/module-sdk/worker";

import { JOB_SEARCH_STATIC_FETCH_HOSTS } from "../../db/tables.js";
import type { CustomSource, JobSearchStore } from "../../domain/store-port.js";
import { InputError, stripEnvelope } from "../validate.js";
import { requireNoUnknownKeys, requireProfileId } from "./profile.js";

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

// The one constant both handlers and the manifest declaration must agree on. Declared here, not
// in domain code, because it names a platform storage concept (a kv namespace), not a job-search
// domain concept.
export const FETCH_HOST_GRANTS_NAMESPACE = "job-search.fetch-host-grants";

// "custom:" is store-sql.ts's own join-key prefix (Task 24) — checked here, not re-derived, so
// this file and the store agree on what a custom source id looks like without either importing
// the other's constant.
const CUSTOM_SOURCE_ID_PREFIX = "custom:";

const SOURCE_ADD_FIELDS = new Set(["profileId", "url", "label"]);
const SOURCE_REMOVE_FIELDS = new Set(["profileId", "sourceId"]);

/**
 * Local copy of `packages/host-fetch/src/policy.ts`'s `isPinnableHost` predicate — NOT an
 * import. `external-modules/job-search/tsconfig.json`'s `paths` map is closed to exactly
 * `@jarv1s/module-sdk/worker` (this module has no `node_modules` and no other declared
 * dependency; that closed map IS the isolation boundary, not an oversight), so a real import of
 * `@jarv1s/host-fetch/policy` cannot resolve under `pnpm check:external-modules`'s
 * `tsc -p external-modules/job-search --noEmit`.
 *
 * This is a courtesy pre-check, not the security boundary, which is why duplicating it here is
 * safe rather than a policy drift risk: the real enforcement is unchanged and still entirely
 * platform-side (`assertValidFetchHosts`/`createHostPinnedFetch`, run again on every
 * `fetch.request`, using the *actual* `packages/host-fetch/src/policy.ts` copy) regardless of
 * what this duplicate accepts or rejects — a host this check wrongly let through would still be
 * rejected at fetch time, and a host this check wrongly rejected only costs the caller a retry.
 * Kept identical in name and logic (not simplified) so a future SDK re-export of this predicate
 * is a one-line swap. Flagged to team-lead as a designed-not-found gap: the plan's "reuse, don't
 * rebuild the host check" assumed an import was possible; module isolation makes it not.
 */
function isPinnableHost(host: string): boolean {
  if (host.length === 0 || host !== host.toLowerCase() || host.includes(":")) return false;
  return !/^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/** `new URL` throwing, a non-`https:` scheme, and a hostname `isPinnableHost` rejects (IP
 * literal, uppercase, has a port) are three distinct causes (test 1) — each gets its own message
 * naming the failed check, matching `validate.ts`'s house rule of never echoing the value. */
function requireValidSourceUrl(input: Record<string, unknown>): { url: string; host: string } {
  const raw = input.url;
  if (typeof raw !== "string" || raw.length === 0) {
    throw new InputError("url is required");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new InputError("url is not a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new InputError("url must use https");
  }
  const host = parsed.hostname.toLowerCase();
  if (!isPinnableHost(host)) {
    throw new InputError("url host is not a valid fetch host");
  }
  return { url: raw, host };
}

/** Only present when the caller supplies one — `addCustomSource` still needs a string, so an
 * omitted label falls back to the host itself (a design call: the schema makes `label` optional,
 * but the store's `label` column is NOT NULL and nothing else in this handler has a better
 * default than the thing the user is actually looking at). */
function resolveLabel(input: Record<string, unknown>, host: string): string {
  const value = input.label;
  if (value === undefined) return host;
  if (typeof value !== "string" || value.length === 0) {
    throw new InputError("label must be a non-empty string");
  }
  return value;
}

function requireSourceId(input: Record<string, unknown>): string {
  const value = input.sourceId;
  if (typeof value !== "string" || value.length === 0) {
    throw new InputError("sourceId is required");
  }
  return value;
}

function requireCustomSourceId(input: Record<string, unknown>): string {
  const sourceId = requireSourceId(input);
  if (!sourceId.startsWith(CUSTOM_SOURCE_ID_PREFIX)) {
    throw new InputError("sourceId is not a custom source");
  }
  return sourceId;
}

function shapeCustomSource(profileId: string, source: CustomSource): Record<string, unknown> {
  return {
    profileId,
    sourceId: source.sourceId,
    host: source.host,
    label: source.label,
    url: source.url,
    createdAt: source.createdAt
  };
}

export function createSourceAddHandler(store: JobSearchStore) {
  return async (ctx: ModuleWorkerContext): Promise<Record<string, unknown>> => {
    const input = stripEnvelope(ctx.input);
    requireNoUnknownKeys(input, SOURCE_ADD_FIELDS);
    const profileId = requireProfileId(input);
    const { url, host } = requireValidSourceUrl(input);
    const label = resolveLabel(input, host);

    const profile = await store.getProfile(profileId);
    if (!profile) {
      throw new InputError("profileId not found");
    }

    // A custom source shadowing a built-in adapter would get the built-in's worse, unstructured
    // extraction instead of its real parser, for no benefit (Constraints). Checked here, before
    // the write sequence — this is job-search's own business rule, not something the generic
    // kv.set branch below could know.
    if ((JOB_SEARCH_STATIC_FETCH_HOSTS as readonly string[]).includes(host)) {
      throw new InputError(`${host} already has a built-in source`);
    }

    // Ledger N17 (storage mechanism revised by N18): add writes the source row first, then the
    // grant second — a crash between the two leaves a visible-but-inert source definition, never
    // an invisible capability with no listing behind it.
    const source = await store.addCustomSource(profileId, url, label);
    await ctx.kv.set("user", FETCH_HOST_GRANTS_NAMESPACE, source.host, {});

    return shapeCustomSource(profileId, source);
  };
}

export function createSourceRemoveHandler(store: JobSearchStore) {
  return async (ctx: ModuleWorkerContext): Promise<Record<string, unknown>> => {
    const input = stripEnvelope(ctx.input);
    requireNoUnknownKeys(input, SOURCE_REMOVE_FIELDS);
    const profileId = requireProfileId(input);
    const sourceId = requireCustomSourceId(input);

    const profile = await store.getProfile(profileId);
    if (!profile) {
      throw new InputError("profileId not found");
    }

    // JobSearchStore (Task 13) is closed with no `getCustomSource` — `listCustomSources` is the
    // only read this interface offers, so the host this sourceId maps to is resolved by listing
    // and filtering, the same way portal.ts already resolves a custom source's label/host for
    // its merge.
    const sources = await store.listCustomSources(profileId);
    const match = sources.find((candidate) => candidate.sourceId === sourceId);
    if (!match) {
      throw new InputError("sourceId not found");
    }

    // Ledger N17 (storage mechanism revised by N18): remove is the reverse order from add — the
    // grant is revoked first, then the source row is deleted, so a crash between the two always
    // leaves the narrower state (an orphaned row with no fetch capability), never the wider one
    // (a capability with no visible listing explaining it).
    await ctx.kv.delete("user", FETCH_HOST_GRANTS_NAMESPACE, match.host);
    await store.removeCustomSource(profileId, sourceId);

    return { profileId, sourceId };
  };
}
