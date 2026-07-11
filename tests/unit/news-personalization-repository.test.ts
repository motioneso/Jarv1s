import { describe, expect, it } from "vitest";

import { dataContextBrand, type DataContextDb } from "@jarv1s/db";
import {
  NEWS_MAX_SOURCE_EXCLUSIONS,
  NewsPersonalizationLimitError,
  NewsPersonalizationRepository
} from "../../packages/news/src/personalization-repository.js";

// #953 Task 3 — the pure branches only. RLS/cap/upsert behavior needs Postgres and lives in
// tests/integration/news-personalization-repository.test.ts.

/** Branded stub whose `db` explodes on ANY access — proves a code path never reaches SQL. */
function sqlExplodingScopedDb(): DataContextDb {
  const db = new Proxy(
    {},
    {
      get() {
        throw new Error("unexpected SQL access");
      }
    }
  );
  return { db, [dataContextBrand]: true } as DataContextDb;
}

describe("news personalization repository pure branches (#953 Task 3)", () => {
  const repo = new NewsPersonalizationRepository();

  it("exposes the spec's exclusion cap as a constant", () => {
    expect(NEWS_MAX_SOURCE_EXCLUSIONS).toBe(100);
  });

  it("NewsPersonalizationLimitError carries the resource and limit for typed handling", () => {
    const error = new NewsPersonalizationLimitError("source_exclusions", 100);
    expect(error).toBeInstanceOf(Error);
    expect(error.resource).toBe("source_exclusions");
    expect(error.limit).toBe(100);
    expect(error.message).toContain("100");
  });

  it("replaceLatestSnapshot runs the payload guard BEFORE touching SQL", async () => {
    await expect(
      repo.replaceLatestSnapshot(sqlExplodingScopedDb(), {
        compiledAt: new Date("2026-07-11T06:00:00Z"),
        expiresAt: new Date("2026-07-11T12:00:00Z"),
        payload: { articles: "not-an-array" }
      })
    ).rejects.toThrow(/articles/);
  });
});
