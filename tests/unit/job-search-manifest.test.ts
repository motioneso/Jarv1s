// tests/unit/job-search-manifest.test.ts
//
// Task 3 (#1287): the manifest every later Job Search task registers into. Every case here
// asserts through validateExternalModuleManifest()'s validated output, never the raw JSON —
// the validator reconstructs the manifest from an allow-list and silently drops fields it does
// not know (F1), so a test reading the JSON file directly would pass for a manifest the real
// loader strips to pieces.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateExternalModuleManifest } from "@jarv1s/module-registry";

import {
  JOB_SEARCH_STATIC_FETCH_HOSTS,
  JOB_SEARCH_TABLES
} from "../../external-modules/job-search/src/db/tables.js";
import { CRITERIA_SCHEMA } from "../../external-modules/job-search/src/domain/criteria.js";
import { MATCHES_LIST_MAX_LIMIT } from "../../external-modules/job-search/src/domain/records.js";
import { HANDLERS } from "../../external-modules/job-search/src/worker/registry.js";

const manifestPath = fileURLToPath(
  new URL("../../external-modules/job-search/jarvis.module.json", import.meta.url)
);
const loadManifest = (): Record<string, unknown> =>
  JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;

describe("job-search manifest scaffold (#1287)", () => {
  it("validates against the real loader", () => {
    const result = validateExternalModuleManifest(loadManifest(), "job-search", "0.1.0");
    expect(result.ok, JSON.stringify(!result.ok ? result.errors : [])).toBe(true);
  });

  it("declares only hosts that serve public postings", () => {
    const result = validateExternalModuleManifest(loadManifest(), "job-search", "0.1.0");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A third host appearing here is a scope change, not a typo — Indeed is cut from v1 (L1).
    expect(result.manifest.fetchHosts).toEqual(["www.linkedin.com", "freehire.me"]);
  });

  it(
    "keeps JOB_SEARCH_STATIC_FETCH_HOSTS (source.add's built-in-collision check) in sync with " +
      "the manifest's fetchHosts",
    () => {
      // Task 24 (#1309): source.ts's "already has a built-in source" rejection reads a TypeScript
      // copy of this same list — JSON manifests cannot import a TS constant, same reasoning as
      // JOB_SEARCH_TABLES above. This is the one thing that stops the two from drifting.
      const result = validateExternalModuleManifest(loadManifest(), "job-search", "0.1.0");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.manifest.fetchHosts).toEqual([...JOB_SEARCH_STATIC_FETCH_HOSTS]);
    }
  );

  it("owns exactly the tables JOB_SEARCH_TABLES names, in the same order", () => {
    const result = validateExternalModuleManifest(loadManifest(), "job-search", "0.1.0");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // THE seam (F2): the JSON literal in jarvis.module.json and the TS constant in
    // src/db/tables.ts are two independent copies of one list — this deep equality,
    // including order, is the only thing in the toolchain that relates them. A table added
    // to one and forgotten in the other produces a module that installs happily and then has
    // an unprotected or a non-existent table.
    expect(result.manifest.database?.ownedTables).toEqual(
      JOB_SEARCH_TABLES.map((table: string) => `app.${table}`)
    );
  });

  it("names six tables", () => {
    // Pinned separately so that "fixing" the case above by editing both lists at once still
    // fails and forces the spec conversation, rather than silently accepting a drifted count.
    // Six, not five, as of Task 24 (#1309): job_search_custom_sources joined the list.
    expect(JOB_SEARCH_TABLES).toHaveLength(6);
  });

  it("survives reconstruction with its briefing block and nav badge intact", () => {
    const result = validateExternalModuleManifest(loadManifest(), "job-search", "0.1.0");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Both fields are new to the validator (Tasks 2 and 2d): this is the assertion that
    // catches a validator that accepts but does not re-emit (F1).
    expect(result.manifest.briefing).toEqual({
      handler: "briefing.contribute",
      sections: ["morning", "evening"],
      toolName: "job-search.briefing"
    });
    expect(result.manifest.navigation?.[0]?.badge).toEqual({ source: "notifications" });
  });

  it("keeps the briefing handler out of the chat tool registry", () => {
    const result = validateExternalModuleManifest(loadManifest(), "job-search", "0.1.0");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A briefing handler is a worker handler, which is what keeps it invisible to chat. The
    // validator never enumerates handlers, so this asserts the negative directly: no
    // assistantTools entry (Task 16 populated this array with the conversation/profile/résumé/
    // settings tools; the assertion narrows from "empty" to "none of them route to the
    // briefing handler") and no queue routes to briefing.contribute.
    const toolHandlers = (result.manifest.assistantTools ?? []).map((tool) => tool.handler);
    expect(toolHandlers).not.toContain("briefing.contribute");
    const queueHandlers = (result.manifest.worker?.queues ?? []).map((queue) => queue.handler);
    expect(queueHandlers).not.toContain("briefing.contribute");
  });

  it("exposes no blended score through any tool schema", () => {
    const result = validateExternalModuleManifest(loadManifest(), "job-search", "0.1.0");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // L9: two axes (Fit and Want) are never blended into one score. Cheap, and it fails the
    // moment someone adds a convenience field in a later task.
    const serialized = JSON.stringify(result.manifest);
    for (const forbidden of ["overall", "combinedScore", "totalScore", "matchScore"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("job-search install grant (#1246)", () => {
  it("declares one action family for routine job-search changes", () => {
    const result = validateExternalModuleManifest(loadManifest(), "job-search", "0.1.0");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.manifest.assistantActionFamilies).toEqual([
      {
        id: "profile_changes",
        label: "Job-search changes",
        description: "Manage your private job searches, sources, résumés, and matches.",
        defaultTier: "ask_each_time",
        allowedTiers: ["ask_each_time", "trusted_auto", "always_confirm"]
      }
    ]);
  });

  it("grants all ten routine writes at install", () => {
    const result = validateExternalModuleManifest(loadManifest(), "job-search", "0.1.0");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const writes = (result.manifest.assistantTools ?? []).filter((tool) => tool.risk === "write");
    expect(writes).toHaveLength(10);
    for (const tool of writes) {
      expect(tool).toMatchObject({
        actionFamilyId: "profile_changes",
        executionPolicy: "auto",
        selfOperationGrant: "granted_at_install"
      });
    }
  });
});

// Task 15 (#1299): the worker queues, schedule, and tool risk levels this task's handlers wire
// into the manifest. Asserted through validateExternalModuleManifest()'s output, same discipline
// as every other case in this file. The original spec text for the first case below says "THREE
// entries" for worker.queues — that was the count before the peer-requested settings queues
// (job-search.portal-set-enabled, job-search.profile-set-briefing-detail) joined the manifest, so
// this narrows to "those three specifically exist among the five" and adds two more cases for
// the additions, rather than re-asserting a stale total.
describe("job-search manifest: worker queues, schedule, and risk levels (#1299)", () => {
  function loadValidatedManifest() {
    const result = validateExternalModuleManifest(loadManifest(), "job-search", "0.1.0");
    if (!result.ok) {
      throw new Error(`job-search manifest failed to validate: ${JSON.stringify(result.errors)}`);
    }
    return result.manifest;
  }

  it("declares crawl.run and crawl.sweep among worker.queues", () => {
    const manifest = loadValidatedManifest();
    const queuesByHandler = new Map((manifest.worker?.queues ?? []).map((q) => [q.handler, q]));
    expect(queuesByHandler.has("crawl.run")).toBe(true);
    expect(queuesByHandler.has("crawl.sweep")).toBe(true);
  });

  it("queues[0].timeoutMs is 600000 — a crawl+score pass gets the full ten minutes", () => {
    const manifest = loadValidatedManifest();
    expect(manifest.worker?.queues?.[0]?.timeoutMs).toBe(600000);
  });

  it("the schedule fires job-search.crawl-sweep", () => {
    const manifest = loadValidatedManifest();
    expect(manifest.worker?.schedules?.[0]?.queue).toBe("job-search.crawl-sweep");
  });

  it("job-search.match-state survives with allowManualRun: true", () => {
    const manifest = loadValidatedManifest();
    const queue = (manifest.worker?.queues ?? []).find((q) => q.name === "job-search.match-state");
    expect(queue?.allowManualRun).toBe(true);
  });

  it("job-search.portal-set-enabled and job-search.profile-set-briefing-detail survive with allowManualRun: true", () => {
    // The two settings queues the board's manual-run lane depends on (peer instruction, since
    // packages/ai/src/routes.ts 403s a write-risk TOOL call with confirmation_required — these
    // settings changes go through the queue lane instead).
    const manifest = loadValidatedManifest();
    const queuesByName = new Map((manifest.worker?.queues ?? []).map((q) => [q.name, q]));
    expect(queuesByName.get("job-search.portal-set-enabled")?.allowManualRun).toBe(true);
    expect(queuesByName.get("job-search.profile-set-briefing-detail")?.allowManualRun).toBe(true);
  });

  it("job-search.matches.list is risk: read and job-search.match.dismiss is risk: write", () => {
    const manifest = loadValidatedManifest();
    const toolsByName = new Map((manifest.assistantTools ?? []).map((t) => [t.name, t]));
    expect(toolsByName.get("job-search.matches.list")?.risk).toBe("read");
    expect(toolsByName.get("job-search.match.dismiss")?.risk).toBe("write");
  });

  it(
    "keeps job-search.matches.list's inputSchema limit.maximum in sync with " +
      "MATCHES_LIST_MAX_LIMIT (N43)",
    () => {
      // N43 debt: MATCHES_LIST_MAX_LIMIT was hoisted into domain/records.ts so matches.ts's
      // requireLimit and board.tsx share one TS constant, but this manifest's JSON schema is a
      // THIRD site that cannot import it (same JSON-can't-import-TS reasoning as
      // JOB_SEARCH_TABLES/JOB_SEARCH_STATIC_FETCH_HOSTS above) — the value here was moved by
      // hand in the same commit that hoisted the constant. This is the coupling N43 called out
      // as mattering most: the manifest schema rejects an over-limit request before
      // requireLimit ever runs, so drift here surfaces one layer earlier and reads as a
      // different bug (a rejected board load, not an InputError) than the one N43 was written
      // to prevent.
      const manifest = loadValidatedManifest();
      const toolsByName = new Map((manifest.assistantTools ?? []).map((t) => [t.name, t]));
      const inputSchema = toolsByName.get("job-search.matches.list")?.inputSchema as
        | { properties?: { limit?: { maximum?: number } } }
        | undefined;
      expect(inputSchema?.properties?.limit?.maximum).toBe(MATCHES_LIST_MAX_LIMIT);
    }
  );

  it("every schedule names a declared queue", () => {
    const manifest = loadValidatedManifest();
    const queueNames = new Set((manifest.worker?.queues ?? []).map((q) => q.name));
    for (const schedule of manifest.worker?.schedules ?? []) {
      expect(queueNames.has(schedule.queue)).toBe(true);
    }
  });
});

// Task 15 (#1299) follow-up, per registry.ts's own header comment: a renamed or removed handler
// on either side of this seam must fail here, not silently at runtime with nothing going red
// (ledger N23). This is a different mapping from job-search-manifest-conformance.test.ts, which
// only checks that a web-layer `job-search.*` literal resolves to a declared TOOL or QUEUE NAME
// (a `job-search.`-prefixed string) — never touching `registry.ts` or its `HANDLERS` map at all.
// Here the comparison is entirely on the OTHER side of that mapping: the bare `handler` field
// (`"crawl.run"`, never `"job-search.crawl-run"`) that `assistantTools[].handler`,
// `worker.queues[].handler`, and `briefing.handler` each declare, cross-checked against the keys
// of the side-effect-free `HANDLERS` map that `worker/index.ts` wires at runtime.
describe("registry.ts's HANDLERS map vs. the manifest's declared handler names (#1299)", () => {
  function loadValidatedManifest() {
    const result = validateExternalModuleManifest(loadManifest(), "job-search", "0.1.0");
    if (!result.ok) {
      throw new Error(`job-search manifest failed to validate: ${JSON.stringify(result.errors)}`);
    }
    return result.manifest;
  }

  function declaredHandlerNames(): Set<string> {
    const manifest = loadValidatedManifest();
    const names = new Set<string>();
    for (const tool of manifest.assistantTools ?? []) {
      if (tool.handler !== undefined) names.add(tool.handler);
    }
    for (const queue of manifest.worker?.queues ?? []) {
      names.add(queue.handler);
    }
    if (manifest.briefing !== undefined) names.add(manifest.briefing.handler);
    return names;
  }

  it("registers every handler name the manifest declares — nothing missing", () => {
    const declared = declaredHandlerNames();
    const registered = new Set(Object.keys(HANDLERS));

    const missing = [...declared].filter((name) => !registered.has(name));
    // A handler the manifest names but registry.ts never wires is exactly the "renamed a tool's
    // handler and forgot the registry" mistake ledger N23 warns about — it 500s at runtime with
    // nothing in any test suite going red until this check exists.
    expect(
      missing,
      `manifest declares a handler registry.ts never registers: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("declares somewhere in the manifest every handler registry.ts actually registers — nothing orphaned", () => {
    const declared = declaredHandlerNames();
    const registered = new Set(Object.keys(HANDLERS));

    const orphaned = [...registered].filter((name) => !declared.has(name));
    // The reverse direction: a registered handler nothing in the manifest ever names is dead
    // code at best, and at worst a handler someone meant to wire to a tool or queue and forgot —
    // either way it belongs in this file's conversation, not in silent drift.
    expect(
      orphaned,
      `registry.ts registers a handler the manifest never declares: ${orphaned.join(", ")}`
    ).toEqual([]);
  });

  it("is not a vacuous pass — both sides have the full, non-trivial count", () => {
    // Guards the guard: if the manifest walk or the HANDLERS import ever silently resolved to
    // nothing (a broken relative path after a file move, an empty object from a bad merge), both
    // sets above would be equal by both being empty, and the two tests above would pass for the
    // wrong reason.
    expect(declaredHandlerNames().size).toBeGreaterThanOrEqual(15);
    expect(Object.keys(HANDLERS).length).toBeGreaterThanOrEqual(15);
  });

  it("spells out criteria.set's field vocabulary, matching what parseCriteria admits", () => {
    // The schema in the manifest is the ONLY description of this shape the model ever sees, and
    // `parseCriteria` throws `unexpected field` on anything outside its vocabulary. When the
    // manifest declared a bare `{"type":"object"}`, a live run guessed `locationPreference`, the
    // handler threw, and the approval card still reported success — the user approved a write
    // that saved nothing. The two lists must not drift apart again.
    const result = validateExternalModuleManifest(loadManifest(), "job-search", "0.1.0");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const tool = result.manifest.assistantTools?.find((t) => t.name === "job-search.criteria.set");
    const properties = (
      (
        tool?.inputSchema as {
          properties?: { criteria?: { properties?: Record<string, unknown> } };
        }
      ).properties?.criteria ?? {}
    ).properties;

    expect(Object.keys(properties ?? {}).sort()).toEqual(
      Object.keys(CRITERIA_SCHEMA.properties).sort()
    );
  });

  it("names every built-in host in source.add, which rejects them", () => {
    // `source.add` throws `<host> already has a built-in source` for anything in
    // JOB_SEARCH_STATIC_FETCH_HOSTS, and the schema is the model's only warning that the rule
    // exists. A live run asked to "use freehire.me as the source" called source.add twice, was
    // rejected twice, and the user saw "Resolved." both times — the profile never got a portal
    // and so never reached readyToCrawl. If a built-in host is ever added, this list must be
    // updated with it.
    const result = validateExternalModuleManifest(loadManifest(), "job-search", "0.1.0");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const tool = result.manifest.assistantTools?.find((t) => t.name === "job-search.source.add");
    const schemaText = JSON.stringify(tool?.inputSchema ?? {});
    for (const host of JOB_SEARCH_STATIC_FETCH_HOSTS) {
      expect(schemaText).toContain(host);
    }
  });

  it("names the built-in portal ids in portal.set-enabled", () => {
    // The other half of the same trap: knowing freehire.me is built in is useless unless the
    // model also knows the id to switch it on with is "freehire", not the hostname. These two
    // ids are the module's own adapters (adapters/freehire.ts, adapters/linkedin.ts).
    const result = validateExternalModuleManifest(loadManifest(), "job-search", "0.1.0");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const tool = result.manifest.assistantTools?.find(
      (t) => t.name === "job-search.portal.set-enabled"
    );
    const schemaText = JSON.stringify(tool?.inputSchema ?? {});
    expect(schemaText).toContain('\\"freehire\\"');
    expect(schemaText).toContain('\\"linkedin\\"');
  });
});
