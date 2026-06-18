import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OutgoingHttpHeaders } from "node:http";
import { type Kysely } from "kysely";

import { createApiServer } from "../../apps/api/src/server.js";
import type {
  CliChatEngine,
  EngineLaunchOpts,
  TranscriptRecord
} from "../../packages/chat/src/live/types.js";
import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import { ConnectorsRepository, createConnectorSecretCipher } from "@jarv1s/connectors";
import type { ChatEngineFactory } from "@jarv1s/module-registry";
import { SettingsRepository } from "../../packages/settings/src/repository.js";
import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";

// Canonical cookie extraction (mirrors tests/integration/auth-settings.test.ts) — strips
// attributes so the joined header is a clean "name=value; name2=value2" string.
function cookieHeader(headers: OutgoingHttpHeaders): string {
  const setCookie = headers["set-cookie"];
  const cookies = Array.isArray(setCookie)
    ? setCookie
    : typeof setCookie === "string" || typeof setCookie === "number"
      ? [String(setCookie)]
      : [];
  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

class FakeProviderCheckEngine implements CliChatEngine {
  private submitted = false;

  constructor(public readonly provider: CliChatEngine["provider"]) {}

  async launch(_opts: EngineLaunchOpts): Promise<void> {}

  async submit(_text: string): Promise<void> {
    this.submitted = true;
  }

  async readNew(
    afterOffset: number
  ): Promise<{ records: TranscriptRecord[]; offset: number; complete: boolean }> {
    if (!this.submitted) return { records: [], offset: afterOffset, complete: false };
    return { records: [{ kind: "reply", text: "OK" }], offset: afterOffset + 1, complete: true };
  }

  async isAlive(): Promise<boolean> {
    return true;
  }

  async kill(): Promise<void> {}
}

const fakeProviderCheckFactory: ChatEngineFactory = (provider) =>
  new FakeProviderCheckEngine(provider);

describe("Phase 2 onboarding — getOnboardingStatus (derived steps)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let server: ReturnType<typeof createApiServer>;
  let dataContext: DataContextRunner;
  let ownerCookie: string;
  let ownerUserId: string;

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    server = createApiServer({ appDb, logger: false });
    await server.ready();

    const signUp = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: {
        name: "Owner",
        email: "owner@onboarding.test",
        password: "correct horse battery staple"
      }
    });
    ownerCookie = cookieHeader(signUp.headers);
    ownerUserId = signUp.json<{ user: { id: string } }>().user.id;
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
  });

  it("returns state=pending + all steps not-done for a fresh bootstrap owner", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { cookie: ownerCookie }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      state: string;
      steps: {
        multiplexer: { done: boolean; selected: string | null };
        cliAuth: { done: boolean; providers: { kind: string; cliPresent: boolean }[] };
        connectors: { done: boolean };
      };
    };
    expect(body.state).toBe("pending");
    // selected is null only when no chat.multiplexer row exists yet on a fresh instance.
    expect(body.steps.multiplexer.selected).toBeNull();
    // multiplexer.done is false because nothing is selected/usable yet (host-independent:
    // selected===null ⇒ not done regardless of installed binaries).
    expect(body.steps.multiplexer.done).toBe(false);
    expect(body.steps.connectors.done).toBe(false);
    // No secret-shaped field anywhere.
    expect(JSON.stringify(body)).not.toMatch(/token|secret|password|credential/i);
  });

  it("marks the multiplexer step done after chat.multiplexer is set to a usable choice", async () => {
    // Use the DEDICATED, audited adapter route (PUT /api/admin/chat-multiplexer) — the
    // single owner of chat.multiplexer. Onboarding never writes that key directly.
    const put = await server.inject({
      method: "PUT",
      url: "/api/admin/chat-multiplexer",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: { multiplexer: "auto" }
    });
    expect(put.statusCode).toBe(200);

    const res = await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { cookie: ownerCookie }
    });
    const body = res.json() as {
      steps: {
        multiplexer: {
          done: boolean;
          selected: string | null;
          tmuxUsable: boolean;
          herdrUsable: boolean;
        };
      };
    };
    // selected reflects the persisted choice ("auto"). done depends on host usability,
    // which is host-dependent in the real server; assert selected + that done is a boolean
    // consistent with usability (done ⇔ at least one usable for "auto").
    expect(body.steps.multiplexer.selected).toBe("auto");
    const anyUsable = body.steps.multiplexer.tmuxUsable || body.steps.multiplexer.herdrUsable;
    expect(body.steps.multiplexer.done).toBe(anyUsable);
  });

  it("derives connectors.done=true after a real connector account exists", async () => {
    await dataContext.withDataContext(
      { actorUserId: ownerUserId, requestId: "req-seed-connector" },
      (scopedDb) =>
        new ConnectorsRepository().createAccount(scopedDb, {
          providerId: "google",
          scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
          encryptedSecret: createConnectorSecretCipher().encryptJson({
            accessToken: "seeded-token-not-asserted"
          })
        })
    );

    const status = await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { cookie: ownerCookie }
    });
    expect(status.statusCode).toBe(200);
    const body = status.json() as { steps: { connectors: { done: boolean } } };
    expect(body.steps.connectors.done).toBe(true); // proves connectorAccountExists is wired
    expect(status.body).not.toMatch(/seeded-token-not-asserted|accessToken|ciphertext/i);
  });

  it("assembleOnboardingStatus derives flags from a settings row + availability snapshot + connector bool", () => {
    // Pure assembler — no DB, no host, no transaction. Exercised directly so derivation
    // logic runs deterministically regardless of the CI host's installed binaries.
    const repository = new SettingsRepository();
    const status = repository.assembleOnboardingStatus({
      state: "pending",
      selected: "herdr",
      availability: { tmuxUsable: true, herdrUsable: false },
      cliPresentByKind: { anthropic: true, "openai-compatible": false, google: false },
      connectorAccountExists: true
    });
    expect(status.state).toBe("pending");
    // herdr selected but NOT usable (no root pane) ⇒ multiplexer.done is FALSE even though
    // herdr's binary may be present — bare presence is insufficient (Codex R1 herdr finding).
    expect(status.steps.multiplexer.selected).toBe("herdr");
    expect(status.steps.multiplexer.done).toBe(false);
    expect(status.steps.multiplexer.tmuxUsable).toBe(true);
    expect(status.steps.multiplexer.herdrUsable).toBe(false);
    expect(status.steps.cliAuth.providers).toEqual([
      { kind: "anthropic", cliPresent: true },
      { kind: "openai-compatible", cliPresent: false },
      { kind: "google", cliPresent: false }
    ]);
    expect(status.steps.cliAuth.done).toBe(true); // at least one present
    expect(status.steps.connectors.done).toBe(true);
  });

  it("assembleOnboardingStatus: auto is done when either multiplexer is usable", () => {
    const repository = new SettingsRepository();
    const auto = repository.assembleOnboardingStatus({
      state: "pending",
      selected: "auto",
      availability: { tmuxUsable: true, herdrUsable: false },
      cliPresentByKind: { anthropic: false, "openai-compatible": false, google: false },
      connectorAccountExists: false
    });
    expect(auto.steps.multiplexer.done).toBe(true); // auto + tmux usable
    expect(auto.steps.cliAuth.done).toBe(false); // no CLI present
  });

  it("rejects a non-admin caller with 403", async () => {
    // A second, non-admin user. Approval is on by default, so they sign up pending,
    // then the owner approves+demotes is unnecessary — pending users are 403/blocked
    // before reaching admin routes. Sign up a member and assert the status route 403s.
    const member = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: {
        name: "Member",
        email: "member@onboarding.test",
        password: "correct horse battery staple"
      }
    });
    const memberCookie = cookieHeader(member.headers);
    const res = await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { cookie: memberCookie }
    });
    expect([401, 403]).toContain(res.statusCode);
  });
});

describe("Phase 2 onboarding — provider connection check", () => {
  let appDb: Kysely<JarvisDatabase>;
  let server: ReturnType<typeof createApiServer>;
  let ownerCookie: string;

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    server = createApiServer({
      appDb,
      logger: false,
      chatEngineFactory: fakeProviderCheckFactory
    });
    await server.ready();

    const signUp = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: {
        name: "Owner",
        email: "owner-provider-check@onboarding.test",
        password: "correct horse battery staple"
      }
    });
    ownerCookie = cookieHeader(signUp.headers);
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
  });

  it("returns ready when the selected provider CLI launches and replies", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/onboarding/provider-check",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: { providerKind: "anthropic" }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ready" });
  });
});

describe("Phase 2 onboarding — complete/skip (audited)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let server: ReturnType<typeof createApiServer>;
  let ownerCookie: string;

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    server = createApiServer({ appDb, logger: false });
    await server.ready();
    const signUp = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: {
        name: "Owner",
        email: "owner-flag@onboarding.test",
        password: "correct horse battery staple"
      }
    });
    ownerCookie = cookieHeader(signUp.headers);
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
  });

  it("POST /complete sets state=completed and audits onboarding.complete", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/onboarding/complete",
      headers: { cookie: ownerCookie }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ state: "completed" });

    const status = await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { cookie: ownerCookie }
    });
    expect((status.json() as { state: string }).state).toBe("completed");

    const audit = await server.inject({
      method: "GET",
      url: "/api/admin/audit-events",
      headers: { cookie: ownerCookie }
    });
    const actions = (audit.json() as { auditEvents: { action: string }[] }).auditEvents.map(
      (e) => e.action
    );
    expect(actions).toContain("onboarding.complete");
  });

  it("POST /skip sets state=skipped (replacing completed — single enum, never both) and audits", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/onboarding/skip",
      headers: { cookie: ownerCookie }
    });
    expect(res.statusCode).toBe(200);
    // A single enum means skip OVERWRITES completed — the terminal state is unambiguous;
    // there is no "completed && skipped both true" (Codex R1 ambiguous-terminal-state finding).
    expect(res.json()).toEqual({ state: "skipped" });

    const status = await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { cookie: ownerCookie }
    });
    expect((status.json() as { state: string }).state).toBe("skipped");

    const audit = await server.inject({
      method: "GET",
      url: "/api/admin/audit-events",
      headers: { cookie: ownerCookie }
    });
    const actions = (audit.json() as { auditEvents: { action: string }[] }).auditEvents.map(
      (e) => e.action
    );
    expect(actions).toContain("onboarding.skip");
  });

  it("returns 403/401 for a non-admin caller on complete", async () => {
    const member = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: {
        name: "Member",
        email: "member-flag@onboarding.test",
        password: "correct horse battery staple"
      }
    });
    const memberCookie = cookieHeader(member.headers);
    const res = await server.inject({
      method: "POST",
      url: "/api/onboarding/complete",
      headers: { cookie: memberCookie }
    });
    expect([401, 403]).toContain(res.statusCode);
  });
});

// Phase 4 relaxed the onboarding gate from bootstrap-owner-only to requireKnownUser: the
// founder/member split is purely on is_bootstrap_owner, so a promoted NON-owner admin is a
// MEMBER for onboarding purposes (they get the role:"member" per-user flow, not a 403). The
// instance-global founder state stays owner-only — a member's complete/skip stamps the
// member's OWN app.member_onboarding row, never the instance-scoped onboarding.state.
describe("Phase 4 onboarding — promoted non-owner admin is a MEMBER (not founder, not 403)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let server: ReturnType<typeof createApiServer>;
  let ownerCookie: string;
  let adminCookie: string;

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    server = createApiServer({ appDb, logger: false });
    await server.ready();

    // First sign-up becomes the bootstrap owner (active + instance admin + bootstrap owner).
    const owner = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: {
        name: "Owner",
        email: "owner-gate@onboarding.test",
        password: "correct horse battery staple"
      }
    });
    ownerCookie = cookieHeader(owner.headers);

    // Second sign-up is a normal member (pending under default approval).
    const member = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: {
        name: "Admin2",
        email: "admin2-gate@onboarding.test",
        password: "correct horse battery staple"
      }
    });
    adminCookie = cookieHeader(member.headers);
    const memberId = member.json<{ user: { id: string } }>().user.id;

    // Owner approves + promotes the member to a FULL instance admin who is NOT the
    // bootstrap owner — the exact actor the gate must reject.
    const approve = await server.inject({
      method: "POST",
      url: `/api/admin/users/${memberId}/approve`,
      headers: { cookie: ownerCookie }
    });
    expect(approve.statusCode).toBe(200);
    const promote = await server.inject({
      method: "POST",
      url: `/api/admin/users/${memberId}/promote`,
      headers: { cookie: ownerCookie }
    });
    expect(promote.statusCode).toBe(200);
    const promoted = promote.json<{
      user: { isInstanceAdmin: boolean; isBootstrapOwner: boolean };
    }>().user;
    expect(promoted.isInstanceAdmin).toBe(true);
    expect(promoted.isBootstrapOwner).toBe(false);
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
  });

  it("a promoted non-owner admin gets the MEMBER status shape (200, role: member) — Phase 4", async () => {
    // Phase 4: onboarding is no longer bootstrap-owner-only. A non-owner admin is a member
    // for onboarding purposes; they read their OWN per-user state (self-row RLS), never the
    // founder's instance-global state.
    const status = await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { cookie: adminCookie }
    });
    expect(status.statusCode).toBe(200);
    const body = status.json() as { role: string; completed: boolean };
    expect(body.role).toBe("member");
    expect(body.completed).toBe(false);

    // Member complete/skip stamp the member's OWN row and return the { completed } shape.
    const complete = await server.inject({
      method: "POST",
      url: "/api/onboarding/complete",
      headers: { cookie: adminCookie }
    });
    expect(complete.statusCode).toBe(200);
    expect((complete.json() as { completed: boolean }).completed).toBe(true);

    const skip = await server.inject({
      method: "POST",
      url: "/api/onboarding/skip",
      headers: { cookie: adminCookie }
    });
    expect(skip.statusCode).toBe(200);
    expect((skip.json() as { completed: boolean }).completed).toBe(true);
  });

  it("the owner's instance-global onboarding state is untouched by a member's complete/skip", async () => {
    // The member (promoted admin) complete/skip above stamped the member's OWN
    // app.member_onboarding row — they MUST NOT have mutated the single instance-scoped
    // founder onboarding.state, which stays "pending" for the owner.
    const status = await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { cookie: ownerCookie }
    });
    expect(status.statusCode).toBe(200);
    expect((status.json() as { state: string }).state).toBe("pending");
  });

  it("the bootstrap owner still reaches the status payload (gate is not over-tight)", async () => {
    const status = await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { cookie: ownerCookie }
    });
    expect(status.statusCode).toBe(200);
  });
});
