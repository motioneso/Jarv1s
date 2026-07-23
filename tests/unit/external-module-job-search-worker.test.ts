import { describe, expect, it } from "vitest";

import { NS } from "../../external-modules/job-search/src/domain/kv-port.js";
import type { JobSearchKv } from "../../external-modules/job-search/src/domain/kv-port.js";
import type { WorkerPorts } from "../../external-modules/job-search/src/worker/ports.js";
import { HANDLERS } from "../../external-modules/job-search/src/worker/registry.js";
import { wrap } from "../../external-modules/job-search/src/worker/wrap.js";

function ports(records: Record<string, Record<string, unknown>> = {}): WorkerPorts {
  const values = new Map(Object.entries(records));
  const kv: JobSearchKv = {
    get: async (namespace, key) => (namespace === NS.profiles ? (values.get(key) ?? null) : null),
    set: async () => {},
    delete: async () => false,
    list: async (namespace) => (namespace === NS.profiles ? [...values.keys()] : [])
  };
  return {
    kv,
    fetch: null,
    ai: null,
    attachments: { readText: async () => null },
    now: () => new Date("2026-07-22T00:00:00Z")
  };
}

describe("Job Search worker skeleton (#1232)", () => {
  it("returns a first-run hint when no profiles exist", async () => {
    const result = await wrap(HANDLERS["profiles.list"]!(ports()))({});
    expect(result).toEqual({ profiles: [], nextStep: "start a new search" });
  });

  it("lists user-owned profile records through the KV port", async () => {
    const profile = { id: "profile-1", title: "Operations leadership", status: "building" };
    const result = await wrap(HANDLERS["profiles.list"]!(ports({ "profile-1": profile })))({});
    expect(result).toEqual({ profiles: [profile] });
  });
});
