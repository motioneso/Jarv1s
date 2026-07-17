import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OutgoingHttpHeaders } from "node:http";
import type { Kysely } from "kysely";

import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { createPgBossClient, type PgBoss } from "@jarv1s/jobs";
import type { ChatSkillDto, ChatSkillResponse, ListChatSkillsResponse } from "@jarv1s/shared";

import {
  connectionStrings,
  resetEmptyFoundationDatabase,
  setInstanceSetting
} from "./test-database.js";

function cookieHeader(headers: OutgoingHttpHeaders): string {
  const setCookie = headers["set-cookie"];
  const cookies = Array.isArray(setCookie)
    ? setCookie
    : typeof setCookie === "string" || typeof setCookie === "number"
      ? [String(setCookie)]
      : [];
  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

describe("chat skills routes", () => {
  let appDb: Kysely<JarvisDatabase>;
  let boss: PgBoss;
  let server: ReturnType<typeof createApiServer>;
  let ownerCookie: string;
  let otherCookie: string;

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    await setInstanceSetting("registration.requires_approval", { value: false });
    // #1124: createApiServer()'s default boss falls back to pg-boss's own 10s
    // connectionTimeoutMillis, which a loaded CI runner's PG connection establishment can
    // exceed even when the connection ultimately succeeds. Pass an explicit, longer-but-still-
    // under-hookTimeout override so a slow-but-healthy CI connection isn't killed prematurely.
    // Test-only — production callers of createApiServer() are unaffected.
    boss = createPgBossClient(connectionStrings.app, { connectionTimeoutMillis: 25_000 });
    server = createApiServer({ appDb, boss, logger: false });
    await server.ready();

    ownerCookie = await signUp("Owner", "owner.chat-skills@example.test");
    otherCookie = await signUp("Other", "other.chat-skills@example.test");
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy(), boss?.stop({ graceful: false })]);
  });

  it("returns an empty list before any skill is created", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/chat/skills",
      headers: { cookie: ownerCookie }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<ListChatSkillsResponse>().skills).toEqual([]);
  });

  it("requires authentication", async () => {
    const res = await server.inject({ method: "GET", url: "/api/chat/skills" });
    expect(res.statusCode).toBe(401);
  });

  it("round-trips create, list, get, update, toggle, and delete", async () => {
    const create = await server.inject({
      method: "POST",
      url: "/api/chat/skills",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: {
        name: "Standup Notes",
        description: "Summarize standup notes",
        frontmatter: { trigger: "/standup" },
        body: "Body markdown text here."
      }
    });
    expect(create.statusCode).toBe(200);
    const created = create.json<ChatSkillResponse>().skill;
    expect(created).toMatchObject({
      name: "Standup Notes",
      description: "Summarize standup notes",
      frontmatter: { trigger: "/standup" },
      body: "Body markdown text here.",
      enabled: true,
      source: "authored"
    });

    const list = await server.inject({
      method: "GET",
      url: "/api/chat/skills",
      headers: { cookie: ownerCookie }
    });
    expect(list.json<ListChatSkillsResponse>().skills.map((s: ChatSkillDto) => s.id)).toContain(
      created.id
    );

    const get = await server.inject({
      method: "GET",
      url: `/api/chat/skills/${created.id}`,
      headers: { cookie: ownerCookie }
    });
    expect(get.statusCode).toBe(200);
    expect(get.json<ChatSkillResponse>().skill.id).toBe(created.id);

    const update = await server.inject({
      method: "PATCH",
      url: `/api/chat/skills/${created.id}`,
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: { description: "Updated description" }
    });
    expect(update.statusCode).toBe(200);
    expect(update.json<ChatSkillResponse>().skill.description).toBe("Updated description");
    expect(update.json<ChatSkillResponse>().skill.name).toBe("Standup Notes");

    const disable = await server.inject({
      method: "PATCH",
      url: `/api/chat/skills/${created.id}/enabled`,
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: { enabled: false }
    });
    expect(disable.statusCode).toBe(200);
    expect(disable.json<ChatSkillResponse>().skill.enabled).toBe(false);

    const del = await server.inject({
      method: "DELETE",
      url: `/api/chat/skills/${created.id}`,
      headers: { cookie: ownerCookie }
    });
    expect(del.statusCode).toBe(204);

    const afterDelete = await server.inject({
      method: "GET",
      url: `/api/chat/skills/${created.id}`,
      headers: { cookie: ownerCookie }
    });
    expect(afterDelete.statusCode).toBe(404);
  });

  it("404s get/update/toggle/delete for a missing or not-owned id", async () => {
    const create = await server.inject({
      method: "POST",
      url: "/api/chat/skills",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: { name: "Owner Only", body: "secret" }
    });
    const ownerSkillId = create.json<ChatSkillResponse>().skill.id;

    const missingId = "00000000-0000-4000-8000-00000000ffff";
    const get = await server.inject({
      method: "GET",
      url: `/api/chat/skills/${missingId}`,
      headers: { cookie: ownerCookie }
    });
    expect(get.statusCode).toBe(404);

    const getNotOwned = await server.inject({
      method: "GET",
      url: `/api/chat/skills/${ownerSkillId}`,
      headers: { cookie: otherCookie }
    });
    expect(getNotOwned.statusCode).toBe(404);

    const updateNotOwned = await server.inject({
      method: "PATCH",
      url: `/api/chat/skills/${ownerSkillId}`,
      headers: { cookie: otherCookie, "content-type": "application/json" },
      payload: { name: "Hijacked" }
    });
    expect(updateNotOwned.statusCode).toBe(404);

    const toggleNotOwned = await server.inject({
      method: "PATCH",
      url: `/api/chat/skills/${ownerSkillId}/enabled`,
      headers: { cookie: otherCookie, "content-type": "application/json" },
      payload: { enabled: false }
    });
    expect(toggleNotOwned.statusCode).toBe(404);

    const deleteNotOwned = await server.inject({
      method: "DELETE",
      url: `/api/chat/skills/${ownerSkillId}`,
      headers: { cookie: otherCookie }
    });
    expect(deleteNotOwned.statusCode).toBe(404);
  });

  it("rejects blank required text without writing or mutating a skill", async () => {
    const blankCreate = await server.inject({
      method: "POST",
      url: "/api/chat/skills",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: { name: "   ", body: "   " }
    });
    expect(blankCreate.statusCode).toBe(400);

    const create = await server.inject({
      method: "POST",
      url: "/api/chat/skills",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: { name: "Validation target", body: "Original instructions" }
    });
    const id = create.json<ChatSkillResponse>().skill.id;

    const blankUpdate = await server.inject({
      method: "PATCH",
      url: `/api/chat/skills/${id}`,
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: { body: "\n  " }
    });
    expect(blankUpdate.statusCode).toBe(400);

    const unchanged = await server.inject({
      method: "GET",
      url: `/api/chat/skills/${id}`,
      headers: { cookie: ownerCookie }
    });
    expect(unchanged.json<ChatSkillResponse>().skill).toMatchObject({
      name: "Validation target",
      body: "Original instructions"
    });
  });

  it("imports a skill file, byte-identical body, source:'uploaded'", async () => {
    const raw = "---\nname: Imported Skill\ndescription: From a file\n---\nLine one\nLine two\n";

    const res = await server.inject({
      method: "POST",
      url: "/api/chat/skills/import",
      headers: { cookie: ownerCookie, "content-type": "text/markdown" },
      payload: raw
    });

    expect(res.statusCode).toBe(200);
    const skill = res.json<ChatSkillResponse>().skill;
    expect(skill.name).toBe("Imported Skill");
    expect(skill.description).toBe("From a file");
    expect(skill.frontmatter).toEqual({ name: "Imported Skill", description: "From a file" });
    expect(skill.body).toBe("Line one\nLine two\n");
    expect(skill.source).toBe("uploaded");
  });

  it("rejects an import with no closing frontmatter delimiter, no partial row", async () => {
    const before = await server.inject({
      method: "GET",
      url: "/api/chat/skills",
      headers: { cookie: ownerCookie }
    });
    const countBefore = before.json<ListChatSkillsResponse>().skills.length;

    const raw = "---\nname: Unclosed\nBody without a closing delimiter";
    const res = await server.inject({
      method: "POST",
      url: "/api/chat/skills/import",
      headers: { cookie: ownerCookie, "content-type": "text/markdown" },
      payload: raw
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);

    const after = await server.inject({
      method: "GET",
      url: "/api/chat/skills",
      headers: { cookie: ownerCookie }
    });
    expect(after.json<ListChatSkillsResponse>().skills.length).toBe(countBefore);
  });

  it("rejects an import with a malformed frontmatter line", async () => {
    const raw = "---\nname: Foo\nnot a key value line\n---\nBody";
    const res = await server.inject({
      method: "POST",
      url: "/api/chat/skills/import",
      headers: { cookie: ownerCookie, "content-type": "text/markdown" },
      payload: raw
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });

  it("rejects an import missing the required name field", async () => {
    const raw = "---\ndescription: No name here\n---\nBody";
    const res = await server.inject({
      method: "POST",
      url: "/api/chat/skills/import",
      headers: { cookie: ownerCookie, "content-type": "text/markdown" },
      payload: raw
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });

  it.each([
    ["   ", "Body", "Skill name is required"],
    ["Name", "  \n", "Skill instructions are required"]
  ])("rejects an import with blank required text", async (name, body, message) => {
    const raw = `---\nname: ${name}\n---\n${body}`;
    const res = await server.inject({
      method: "POST",
      url: "/api/chat/skills/import",
      headers: { cookie: ownerCookie, "content-type": "text/markdown" },
      payload: raw
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toContain(message);
  });

  it("rejects an oversized import body with an explicit cap", async () => {
    const raw = `---\nname: Big\n---\n${"a".repeat(300 * 1024)}`;
    const res = await server.inject({
      method: "POST",
      url: "/api/chat/skills/import",
      headers: { cookie: ownerCookie, "content-type": "text/markdown" },
      payload: raw
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });

  async function signUp(name: string, email: string): Promise<string> {
    const signUp = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: {
        name,
        email,
        password: "correct horse battery staple"
      }
    });
    expect(signUp.statusCode).toBe(200);
    return cookieHeader(signUp.headers);
  }
});
