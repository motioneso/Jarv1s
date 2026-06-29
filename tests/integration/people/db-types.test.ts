import { afterAll, beforeAll, expect, it } from "vitest";

import { createDatabase, type JarvisDatabase } from "@jarv1s/db";
import type { Kysely } from "kysely";

import { connectionStrings, resetFoundationDatabase } from "../test-database.js";

let db: Kysely<JarvisDatabase>;

beforeAll(async () => {
  await resetFoundationDatabase();
  db = createDatabase({ connectionString: connectionStrings.app, maxConnections: 2 });
});

afterAll(async () => {
  await db?.destroy();
});

it("PersonContextPeopleTable is queryable via JarvisDatabase", async () => {
  const result = await db
    .selectFrom("app.person_context_people")
    .select(["id", "owner_user_id", "display_name", "status"])
    .limit(1)
    .execute();
  expect(Array.isArray(result)).toBe(true);
});

it("PersonContextIdentitiesTable is queryable via JarvisDatabase", async () => {
  const result = await db
    .selectFrom("app.person_context_identities")
    .select(["id", "owner_user_id", "identity_kind", "source_kind", "display_value", "status"])
    .limit(1)
    .execute();
  expect(Array.isArray(result)).toBe(true);
});

it("PersonContextLinksTable is queryable via JarvisDatabase", async () => {
  const result = await db
    .selectFrom("app.person_context_links")
    .select(["id", "owner_user_id", "person_id", "source_kind", "link_kind"])
    .limit(1)
    .execute();
  expect(Array.isArray(result)).toBe(true);
});

it("PersonContextMatchCandidatesTable is queryable via JarvisDatabase", async () => {
  const result = await db
    .selectFrom("app.person_context_match_candidates")
    .select(["id", "owner_user_id", "candidate_kind", "status", "candidate_signature"])
    .limit(1)
    .execute();
  expect(Array.isArray(result)).toBe(true);
});

it("PersonContextIndexingStateTable is queryable via JarvisDatabase", async () => {
  const result = await db
    .selectFrom("app.person_context_indexing_state")
    .select(["owner_user_id", "source", "source_ref_hash"])
    .limit(1)
    .execute();
  expect(Array.isArray(result)).toBe(true);
});
