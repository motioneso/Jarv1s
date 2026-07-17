import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OutgoingHttpHeaders } from "node:http";
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import pg from "pg";

import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import type { MeResponse } from "@jarv1s/shared";
import { createJarvisAuthRuntime, type JarvisAuthRuntime } from "@jarv1s/auth";
import { createPgBossClient, type PgBoss } from "@jarv1s/jobs";
import {
  connectionStrings,
  resetEmptyFoundationDatabase,
  setInstanceSetting
} from "./test-database.js";

/**
 * #239 account self-service deletion. Exercises DELETE /api/me/account end to
 * end against a fresh DB per test: the confirmation factors, the bootstrap/last-
 * admin 409s, the rate limit, the deletion matrix completeness, and the SET-NULL
 * anonymization of retained audit/notification rows.
 */
describe("#239 account self-service deletion", () => {
  let appDb: Kysely<JarvisDatabase>;
  let authRuntime: JarvisAuthRuntime;
  let boss: PgBoss;
  let server: ReturnType<typeof createApiServer>;

  async function signUp(opts: { name: string; email: string; password: string }) {
    return server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: opts
    });
  }

  beforeEach(async () => {
    await resetEmptyFoundationDatabase();
    await setInstanceSetting("registration.requires_approval", { value: false });
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    authRuntime = createJarvisAuthRuntime({ appDb, runner: new DataContextRunner(appDb) });
    // #1124: see multi-user-isolation.test.ts for rationale — override pg-boss's default
    // 10s connectionTimeoutMillis so a slow-but-healthy CI connection isn't killed early.
    boss = createPgBossClient(connectionStrings.app, { connectionTimeoutMillis: 25_000 });
    server = createApiServer({ appDb, authRuntime, boss, logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await Promise.allSettled([
      server?.close(),
      authRuntime?.close(),
      appDb?.destroy(),
      boss?.stop({ graceful: false })
    ]);
  });

  afterAll(async () => {
    await Promise.allSettled([appDb?.destroy()]);
  });

  // The full set of tables userScopedCountQueries must count (spec §decision #9:
  // matrix MUST cover every owner-scoped module table). Asserted against the
  // audit's countsBeforeDelete so a stale/missing entry fails loudly.
  const EXPECTED_MATRIX_KEYS = [
    "app.users",
    "app.auth_sessions",
    "app.auth_accounts",
    "app.better_auth_sessions",
    "app.tasks",
    "app.task_activity",
    "app.notifications",
    "app.notification_reads",
    "app.connector_accounts",
    "app.connector_oauth_pending",
    "app.calendar_events",
    "app.email_messages",
    "app.ai_provider_configs",
    "app.ai_configured_models",
    "app.ai_assistant_action_requests",
    "app.chat_threads",
    "app.chat_messages",
    "app.briefing_definitions",
    "app.briefing_runs",
    "app.task_lists",
    "app.task_tags",
    "app.task_tag_assignments",
    "app.task_preferences",
    "app.shares",
    "app.wellness_checkins",
    "app.medications",
    "app.medication_logs",
    "app.wellness_therapy_notes",
    "app.memory_chunks",
    "app.memory_links",
    "app.memory_file_index",
    "app.chat_memory_facts",
    "app.chat_memory_suppressions",
    "app.chat_user_memory_settings",
    "app.commitments",
    "app.entities",
    "app.preferences",
    "app.module_enablement",
    "app.member_onboarding",
    // sports (#801 Phase A: first module with no prior hardcoded delete-script entry)
    "app.sports_follows"
  ] as const;

  /**
   * Seeds representative owner-scoped rows spanning every module + every matrix
   * extra (memory_links, memory_file_index, connector_oauth_pending,
   * chat_memory_suppressions, chat_user_memory_settings, module_enablement,
   * member_onboarding). Runs on the bootstrap superuser connection (bypasses RLS)
   * to arrange the pre-delete state without going through each module's API.
   */
  async function seedMatrixRows(memberId: string): Promise<void> {
    const client = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      await client.query("BEGIN");
      // tasks + tasks-foundation extras
      const taskListId = randomUUID();
      await client.query(
        `INSERT INTO app.task_lists (id, owner_user_id, name) VALUES ($1, $2, 'seeded list')`,
        [taskListId, memberId]
      );
      await client.query(
        `INSERT INTO app.tasks (id, owner_user_id, title, list_id) VALUES ($1, $2, 'seeded task', $3)`,
        [randomUUID(), memberId, taskListId]
      );
      await client.query(
        `INSERT INTO app.task_tags (id, owner_user_id, list_id, name) VALUES ($1, $2, $3, 'seeded-tag')`,
        [randomUUID(), memberId, taskListId]
      );
      await client.query(
        `INSERT INTO app.task_preferences (owner_user_id) VALUES ($1)
         ON CONFLICT (owner_user_id) DO NOTHING`,
        [memberId]
      );
      // chat + memory (chunks/links/file-index/facts/suppressions/settings)
      await client.query(
        `INSERT INTO app.chat_threads (id, owner_user_id, title) VALUES ($1, $2, 'seeded')`,
        [randomUUID(), memberId]
      );
      await client.query(
        `INSERT INTO app.memory_chunks (id, owner_user_id, source_kind, source_path, line_start, line_end, content_hash, text)
         VALUES ($1, $2, 'vault', 'vault://note.md', 0, 1, 'hash-sentinel', 'seeded chunk')`,
        [randomUUID(), memberId]
      );
      await client.query(
        `INSERT INTO app.memory_links (owner_user_id, from_path, to_path) VALUES ($1, 'a', 'b')`,
        [memberId]
      );
      await client.query(
        `INSERT INTO app.memory_file_index (owner_user_id, source_kind, source_path, file_hash, embed_model_name, embed_model_version)
         VALUES ($1, 'vault', 'vault://note.md', 'file-hash-sentinel', 'nomic', '1.5')`,
        [memberId]
      );
      await client.query(
        `INSERT INTO app.chat_memory_facts (owner_user_id, category, content)
         VALUES ($1, 'preference', 'seeded fact')`,
        [memberId]
      );
      await client.query(
        `INSERT INTO app.chat_memory_suppressions (owner_user_id, signature, category, content, reason)
         VALUES ($1, 'sig-1', 'fact', 'seeded suppression', 'rejected')`,
        [memberId]
      );
      await client.query(`INSERT INTO app.chat_user_memory_settings (user_id) VALUES ($1)`, [
        memberId
      ]);
      // structured-state (commitments/entities/preferences)
      await client.query(
        `INSERT INTO app.commitments (owner_user_id, title, provenance, source_kind)
         VALUES ($1, 'seeded commitment', 'volunteered', 'manual')`,
        [memberId]
      );
      await client.query(
        `INSERT INTO app.entities (owner_user_id, type, name, provenance)
         VALUES ($1, 'person', 'seeded entity', 'volunteered')`,
        [memberId]
      );
      await client.query(
        `INSERT INTO app.preferences (owner_user_id, key, value_json)
         VALUES ($1, 'seeded.pref', '{"v": true}'::jsonb)`,
        [memberId]
      );
      // wellness (#801 Phase A: dataLifecycle.deletion covers all four owned tables)
      const checkinId = randomUUID();
      await client.query(
        `INSERT INTO app.wellness_checkins (id, owner_user_id, feeling_core)
         VALUES ($1, $2, 'happy')`,
        [checkinId, memberId]
      );
      const medicationId = randomUUID();
      await client.query(
        `INSERT INTO app.medications (id, owner_user_id, name, frequency_type)
         VALUES ($1, $2, 'seeded medication', 'as_needed')`,
        [medicationId, memberId]
      );
      await client.query(
        `INSERT INTO app.medication_logs (id, medication_id, owner_user_id, scheduled_for, status)
         VALUES ($1, $2, $3, now(), 'taken')`,
        [randomUUID(), medicationId, memberId]
      );
      await client.query(
        `INSERT INTO app.wellness_therapy_notes (id, owner_user_id, body)
         VALUES ($1, $2, 'seeded therapy note')`,
        [randomUUID(), memberId]
      );
      // sports (#801 Phase A: first cascade-only declaration, no prior hardcoded entry)
      await client.query(
        `INSERT INTO app.sports_follows (id, owner_user_id, competition_key)
         VALUES ($1, $2, 'nfl')`,
        [randomUUID(), memberId]
      );
      // connectors (pending oauth — holds encrypted_secret, but counts only)
      await client.query(
        `INSERT INTO app.connector_oauth_pending (id, owner_user_id, provider_id, state, encrypted_secret)
         VALUES ($1, $2, 'google-calendar', 'state-1', '{"k":"v"}'::jsonb)`,
        [randomUUID(), memberId]
      );
      // settings: per-user module enablement deny row
      await client.query(
        `INSERT INTO app.module_enablement (scope, module_id, user_id)
         VALUES ('user', 'wellness', $1)`,
        [memberId]
      );
      // member onboarding terminal state
      await client.query(
        `INSERT INTO app.member_onboarding (user_id, completed_at) VALUES ($1, now())`,
        [memberId]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      await client.end();
    }
  }

  async function countRows(table: string, predicate: string, userId: string): Promise<number> {
    const client = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ${table} WHERE ${predicate}`,
        [userId]
      );
      return Number(result.rows[0]?.count ?? 0);
    } finally {
      await client.end();
    }
  }

  async function readSelfDeleteAudit(userId: string): Promise<{
    action: string | null;
    metadata: Record<string, unknown> | null;
  }> {
    const client = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      const result = await client.query<{ action: string; metadata: Record<string, unknown> }>(
        `SELECT action, metadata FROM app.admin_audit_events
         WHERE target_id = $1 AND action = 'user.delete.self'
         ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );
      return {
        action: result.rows[0]?.action ?? null,
        metadata: result.rows[0]?.metadata ?? null
      };
    } finally {
      await client.end();
    }
  }

  it("happy path: self-deletes with correct factors; cascade removes every owned row; audit is private", async () => {
    // Bootstrap owner first (first sign-up), then the member who will self-delete.
    await signUp({ name: "Owner", email: "owner@example.test", password: "password12345" });
    const memberRes = await signUp({
      name: "Member",
      email: "member@example.test",
      password: "password12345"
    });
    const memberId = memberRes.json<{ user: { id: string } }>().user.id;
    const memberCookie = cookieHeader(memberRes.headers);
    await seedMatrixRows(memberId);

    const me = await server.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: memberCookie }
    });
    expect(me.json<MeResponse>().hasPasswordCredential).toBe(true);

    const del = await server.inject({
      method: "DELETE",
      url: "/api/me/account",
      headers: { cookie: memberCookie, "content-type": "application/json" },
      payload: {
        confirmEmail: "member@example.test",
        confirmPhrase: "DELETE MY ACCOUNT",
        password: "password12345"
      }
    });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ deletedUserId: memberId });

    // The caller's own session was cascade-destroyed — a follow-up is 401.
    const after = await server.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: memberCookie }
    });
    expect(after.statusCode).toBe(401);

    // Every seeded owner-scoped table is now empty for this user.
    for (const [table, predicate] of [
      ["app.tasks", "owner_user_id = $1::uuid"],
      ["app.task_lists", "owner_user_id = $1::uuid"],
      ["app.task_tags", "owner_user_id = $1::uuid"],
      ["app.memory_chunks", "owner_user_id = $1::uuid"],
      ["app.memory_links", "owner_user_id = $1::uuid"],
      ["app.memory_file_index", "owner_user_id = $1::uuid"],
      ["app.chat_memory_facts", "owner_user_id = $1::uuid"],
      ["app.chat_memory_suppressions", "owner_user_id = $1::uuid"],
      ["app.chat_user_memory_settings", "user_id = $1::uuid"],
      ["app.commitments", "owner_user_id = $1::uuid"],
      ["app.preferences", "owner_user_id = $1::uuid"],
      // wellness (#801 Phase A: dataLifecycle.deletion, all four owned tables)
      ["app.wellness_checkins", "owner_user_id = $1::uuid"],
      ["app.medications", "owner_user_id = $1::uuid"],
      ["app.medication_logs", "owner_user_id = $1::uuid"],
      ["app.wellness_therapy_notes", "owner_user_id = $1::uuid"],
      // sports (#801 Phase A: first cascade-only declaration)
      ["app.sports_follows", "owner_user_id = $1::uuid"],
      ["app.connector_oauth_pending", "owner_user_id = $1::uuid"],
      ["app.module_enablement", "scope = 'user' AND user_id = $1::uuid"],
      ["app.member_onboarding", "user_id = $1::uuid"]
    ] as const) {
      expect(await countRows(table, predicate, memberId)).toBe(0);
    }
    expect(await countRows("app.users", "id = $1::uuid", memberId)).toBe(0);

    // Audit: action discriminator + complete counts + no private payload.
    const audit = await readSelfDeleteAudit(memberId);
    expect(audit.action).toBe("user.delete.self");
    const metadata = audit.metadata ?? {};
    const counts = metadata.countsBeforeDelete as Record<string, number> | undefined;
    expect(counts).toBeDefined();
    // Matrix completeness — every owner-scoped table is counted (spec §decision #9).
    for (const key of EXPECTED_MATRIX_KEYS) {
      expect(counts, `countsBeforeDelete missing ${key}`).toHaveProperty(key);
    }
    // No secret/private content leaks into the audit payload.
    const auditJson = JSON.stringify(audit.metadata);
    expect(auditJson).not.toMatch(/password|token|secret|hash-sentinel|file-hash-sentinel/i);
    expect(auditJson).not.toContain("connector-ciphertext");
  });

  it("wrong email / wrong phrase / missing password each return 400 with nothing deleted", async () => {
    await signUp({ name: "Owner", email: "owner@example.test", password: "password12345" });
    const memberRes = await signUp({
      name: "Member",
      email: "member@example.test",
      password: "password12345"
    });
    const memberId = memberRes.json<{ user: { id: string } }>().user.id;
    const memberCookie = cookieHeader(memberRes.headers);

    const cases = [
      {
        label: "wrong email",
        body: {
          confirmEmail: "wrong@example.test",
          confirmPhrase: "DELETE MY ACCOUNT",
          password: "password12345"
        }
      },
      {
        label: "wrong phrase",
        body: {
          confirmEmail: "member@example.test",
          confirmPhrase: "delete my account",
          password: "password12345"
        }
      },
      {
        label: "missing password on password-bearing account",
        body: { confirmEmail: "member@example.test", confirmPhrase: "DELETE MY ACCOUNT" }
      },
      {
        label: "wrong password",
        body: {
          confirmEmail: "member@example.test",
          confirmPhrase: "DELETE MY ACCOUNT",
          password: "wrong-password"
        }
      }
    ];

    for (const c of cases) {
      const res = await server.inject({
        method: "DELETE",
        url: "/api/me/account",
        headers: { cookie: memberCookie, "content-type": "application/json" },
        payload: c.body
      });
      expect(res.statusCode, c.label).toBe(400);
      // Single generic message — no per-factor detail.
      const body = res.json<{ error?: string; code?: string }>();
      expect(body.error).toMatch(/confirmation does not match/i);
      expect(body.code).toBeUndefined();
    }

    // Nothing deleted, no audit written across all four failed attempts.
    expect(await countRows("app.users", "id = $1::uuid", memberId)).toBe(1);
    const client = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      const audits = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM app.admin_audit_events WHERE target_id = $1`,
        [memberId]
      );
      expect(Number(audits.rows[0]?.count ?? 0)).toBe(0);
    } finally {
      await client.end();
    }
  });

  it("OAuth-only account (no password credential) self-deletes with email + phrase only", async () => {
    await signUp({ name: "Owner", email: "owner@example.test", password: "password12345" });
    const memberRes = await signUp({
      name: "OAuth Member",
      email: "oauth@example.test",
      password: "password12345"
    });
    const memberId = memberRes.json<{ user: { id: string } }>().user.id;
    const memberCookie = cookieHeader(memberRes.headers);

    // Strip the password credential — simulate an OAuth-only account.
    const client = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      await client.query(
        `UPDATE app.auth_accounts SET password = NULL WHERE user_id = $1 AND provider_id = 'credential'`,
        [memberId]
      );
    } finally {
      await client.end();
    }

    const me = await server.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: memberCookie }
    });
    expect(me.json<MeResponse>().hasPasswordCredential).toBe(false);

    const del = await server.inject({
      method: "DELETE",
      url: "/api/me/account",
      headers: { cookie: memberCookie, "content-type": "application/json" },
      payload: { confirmEmail: "oauth@example.test", confirmPhrase: "DELETE MY ACCOUNT" }
    });
    expect(del.statusCode).toBe(200);
    expect(await countRows("app.users", "id = $1::uuid", memberId)).toBe(0);
  });

  it("cross-user isolation: deleting member C anonymizes C-authored notification on B's feed, leaves B intact", async () => {
    // Bootstrap owner (first sign-up), then B and C as ordinary members.
    await signUp({ name: "Owner", email: "owner@example.test", password: "password12345" });
    const bRes = await signUp({
      name: "Member B",
      email: "b@example.test",
      password: "password12345"
    });
    const bId = bRes.json<{ user: { id: string } }>().user.id;
    const cRes = await signUp({
      name: "Member C",
      email: "c@example.test",
      password: "password12345"
    });
    const cId = cRes.json<{ user: { id: string } }>().user.id;
    const cCookie = cookieHeader(cRes.headers);

    // C authors a notification on B's feed (actor=C, recipient=B) and owns a task.
    const client = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO app.notifications (id, actor_user_id, recipient_user_id, title)
         VALUES ($1, $2, $3, 'C acted on B feed')`,
        [randomUUID(), cId, bId]
      );
      const cListId = randomUUID();
      await client.query(
        `INSERT INTO app.task_lists (id, owner_user_id, name) VALUES ($1, $2, 'C list')`,
        [cListId, cId]
      );
      await client.query(
        `INSERT INTO app.tasks (id, owner_user_id, title, list_id) VALUES ($1, $2, 'C task', $3)`,
        [randomUUID(), cId, cListId]
      );
    } finally {
      await client.end();
    }

    const del = await server.inject({
      method: "DELETE",
      url: "/api/me/account",
      headers: { cookie: cCookie, "content-type": "application/json" },
      payload: {
        confirmEmail: "c@example.test",
        confirmPhrase: "DELETE MY ACCOUNT",
        password: "password12345"
      }
    });
    expect(del.statusCode).toBe(200);

    // C's task is gone; C's authored notification on B's feed is retained with actor NULL.
    expect(await countRows("app.tasks", "owner_user_id = $1::uuid", cId)).toBe(0);
    const v = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await v.connect();
    try {
      const note = await v.query<{ actor: string | null; title: string }>(
        `SELECT actor_user_id AS actor, title FROM app.notifications WHERE title = 'C acted on B feed'`
      );
      expect(note.rows.length).toBe(1);
      expect(note.rows[0]?.actor).toBeNull();
      expect(note.rows[0]?.title).toBe("C acted on B feed");
      // B's own row untouched.
      const bExists = await v.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM app.users WHERE id = $1::uuid) AS exists`,
        [bId]
      );
      expect(bExists.rows[0]?.exists).toBe(true);
    } finally {
      await v.end();
    }
  });

  it("bootstrap owner self-delete is hard-blocked (409 bootstrap_owner); row intact", async () => {
    const ownerRes = await signUp({
      name: "Owner",
      email: "owner@example.test",
      password: "password12345"
    });
    const ownerId = ownerRes.json<{ user: { id: string } }>().user.id;
    const ownerCookie = cookieHeader(ownerRes.headers);

    const del = await server.inject({
      method: "DELETE",
      url: "/api/me/account",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: {
        confirmEmail: "owner@example.test",
        confirmPhrase: "DELETE MY ACCOUNT",
        password: "password12345"
      }
    });
    expect(del.statusCode).toBe(409);
    expect(del.json()).toEqual({ code: "bootstrap_owner" });
    expect(await countRows("app.users", "id = $1::uuid", ownerId)).toBe(1);
  });

  it("last active admin self-delete is blocked (409 last_admin); row intact", async () => {
    const ownerRes = await signUp({
      name: "Owner",
      email: "owner@example.test",
      password: "password12345"
    });
    const ownerId = ownerRes.json<{ user: { id: string } }>().user.id;

    // Promote a second (non-bootstrap) member to admin, then deactivate the owner so
    // that member is the sole active admin. Their self-delete must be blocked.
    const memberRes = await signUp({
      name: "Admin Member",
      email: "admin-member@example.test",
      password: "password12345"
    });
    const memberId = memberRes.json<{ user: { id: string } }>().user.id;
    const memberCookie = cookieHeader(memberRes.headers);

    const client = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      await client.query(
        `UPDATE app.users SET is_instance_admin = true, updated_at = now() WHERE id = $1`,
        [memberId]
      );
      // Deactivate the bootstrap owner so the promoted member is the sole active admin.
      await client.query(
        `UPDATE app.users SET status = 'deactivated', updated_at = now() WHERE id = $1`,
        [ownerId]
      );
    } finally {
      await client.end();
    }

    const del = await server.inject({
      method: "DELETE",
      url: "/api/me/account",
      headers: { cookie: memberCookie, "content-type": "application/json" },
      payload: {
        confirmEmail: "admin-member@example.test",
        confirmPhrase: "DELETE MY ACCOUNT",
        password: "password12345"
      }
    });
    expect(del.statusCode).toBe(409);
    expect(del.json()).toEqual({ code: "last_admin" });
    expect(await countRows("app.users", "id = $1::uuid", memberId)).toBe(1);
  });

  it("topology leak guard: bootstrap owner / sole admin with WRONG factors get the generic 400 (no 409)", async () => {
    // R2 (#239): a hijacker who hasn't proven the factors MUST NOT learn that the
    // victim is the bootstrap owner or the sole active admin. The 409 topology
    // discriminators are reserved for callers who have already passed email +
    // phrase + password. The 400 is byte-identical to the one a normal member
    // sees — no per-factor detail, no code.
    const ownerRes = await signUp({
      name: "Owner",
      email: "owner@example.test",
      password: "password12345"
    });
    const ownerId = ownerRes.json<{ user: { id: string } }>().user.id;
    const ownerCookie = cookieHeader(ownerRes.headers);

    // (1) Bootstrap owner, WRONG factors -> generic 400, never 409 bootstrap_owner.
    const ownerWrong = await server.inject({
      method: "DELETE",
      url: "/api/me/account",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: {
        confirmEmail: "wrong@example.test",
        confirmPhrase: "delete my account",
        password: "wrong-password"
      }
    });
    expect(ownerWrong.statusCode).toBe(400);
    const ownerBody = ownerWrong.json<{ error?: string; code?: string }>();
    expect(ownerBody.error).toMatch(/confirmation does not match/i);
    expect(ownerBody.code).toBeUndefined();
    expect(await countRows("app.users", "id = $1::uuid", ownerId)).toBe(1);

    // (2) Sole active admin, WRONG factors -> generic 400, never 409 last_admin.
    const memberRes = await signUp({
      name: "Admin Member",
      email: "admin-member@example.test",
      password: "password12345"
    });
    const memberId = memberRes.json<{ user: { id: string } }>().user.id;
    const memberCookie = cookieHeader(memberRes.headers);

    const client = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      await client.query(
        `UPDATE app.users SET is_instance_admin = true, updated_at = now() WHERE id = $1`,
        [memberId]
      );
      // Deactivate the bootstrap owner so the promoted member is the sole active admin.
      await client.query(
        `UPDATE app.users SET status = 'deactivated', updated_at = now() WHERE id = $1`,
        [ownerId]
      );
    } finally {
      await client.end();
    }

    const adminWrong = await server.inject({
      method: "DELETE",
      url: "/api/me/account",
      headers: { cookie: memberCookie, "content-type": "application/json" },
      payload: {
        confirmEmail: "wrong@example.test",
        confirmPhrase: "delete my account",
        password: "wrong-password"
      }
    });
    expect(adminWrong.statusCode).toBe(400);
    const adminBody = adminWrong.json<{ error?: string; code?: string }>();
    expect(adminBody.error).toMatch(/confirmation does not match/i);
    expect(adminBody.code).toBeUndefined();
    expect(await countRows("app.users", "id = $1::uuid", memberId)).toBe(1);
  });

  it("rate limit: a burst over 5/min returns 429", async () => {
    await signUp({ name: "Owner", email: "owner@example.test", password: "password12345" });
    const memberRes = await signUp({
      name: "Member",
      email: "member@example.test",
      password: "password12345"
    });
    const memberCookie = cookieHeader(memberRes.headers);

    const payload = {
      confirmEmail: "member@example.test",
      confirmPhrase: "DELETE MY ACCOUNT",
      password: "password12345"
    };
    const headers = { cookie: memberCookie, "content-type": "application/json" };

    // The route allows 5/min per principal. The first five attempts have the wrong
    // password so they 400 (cheapest failure that still exercises the limiter);
    // the sixth must be 429.
    for (let i = 0; i < 5; i++) {
      const res = await server.inject({
        method: "DELETE",
        url: "/api/me/account",
        headers,
        payload: { ...payload, password: "wrong" }
      });
      expect(res.statusCode).toBe(400);
    }

    const overLimit = await server.inject({
      method: "DELETE",
      url: "/api/me/account",
      headers,
      payload: { ...payload, password: "wrong" }
    });
    expect(overLimit.statusCode).toBe(429);
  });
});

function cookieHeader(headers: OutgoingHttpHeaders): string {
  const setCookie = headers["set-cookie"];
  const cookies = Array.isArray(setCookie)
    ? setCookie
    : typeof setCookie === "string" || typeof setCookie === "number"
      ? [String(setCookie)]
      : [];
  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}
