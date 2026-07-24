import { describe, expect, it } from "vitest";

import { resetJob } from "../../external-modules/job-search/src/worker/handlers/reset.js";
import {
  NS,
  RESET_MARKER_KEY,
  type JobSearchKv
} from "../../external-modules/job-search/src/domain/kv-port.js";

function fakeKv(seed: Record<string, Record<string, Record<string, unknown>>>): JobSearchKv & {
  deleted: string[];
} {
  const namespaces = new Map(
    Object.entries(seed).map(([namespace, values]) => [namespace, new Map(Object.entries(values))])
  );
  const deleted: string[] = [];
  return {
    deleted,
    async get(namespace, key) {
      return namespaces.get(namespace)?.get(key) ?? null;
    },
    async set(namespace, key, value) {
      let values = namespaces.get(namespace);
      if (!values) {
        values = new Map();
        namespaces.set(namespace, values);
      }
      values.set(key, value);
    },
    async delete(namespace, key) {
      const values = namespaces.get(namespace);
      const existed = values?.delete(key) ?? false;
      if (existed) deleted.push(`${namespace}:${key}`);
      return existed;
    },
    async list(namespace) {
      return [...(namespaces.get(namespace)?.keys() ?? [])];
    }
  };
}

describe("job-search.reset", () => {
  it("wipes every declared namespace once and records an idempotency marker", async () => {
    const kv = fakeKv(
      Object.fromEntries(Object.values(NS).map((namespace) => [namespace, { stale: { value: 1 } }]))
    );

    await expect(resetJob(kv)).resolves.toMatchObject({ status: "ok", resetDone: true });
    expect(kv.deleted).toHaveLength(Object.values(NS).length);
    for (const namespace of Object.values(NS)) {
      expect(await kv.list(namespace)).toEqual(namespace === NS.meta ? [RESET_MARKER_KEY] : []);
    }

    const deletedBeforeRetry = [...kv.deleted];
    await expect(resetJob(kv)).resolves.toEqual({ status: "ok", resetDone: true, deleted: 0 });
    expect(kv.deleted).toEqual(deletedBeforeRetry);
  });
});
