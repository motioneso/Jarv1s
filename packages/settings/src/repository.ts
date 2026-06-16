import { randomUUID } from "node:crypto";

import { sql } from "kysely";

import type { AdminAuditEvent, InstanceSetting, ModuleEnablementRow, User } from "@jarv1s/db";
import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";
import type {
  ChatMultiplexerChoice,
  OnboardingFounderStatus,
  OnboardingState
} from "@jarv1s/shared";

export interface UpsertInstanceSettingInput {
  readonly key: string;
  readonly value: Record<string, unknown>;
  readonly updatedByUserId: string;
  readonly requestId: string;
  /** Override the audit action (default "instance_setting.upsert"). Keeps ONE audit row. */
  readonly action?: string;
  /** Override audit metadata (default { key }). */
  readonly metadata?: Record<string, unknown>;
}

export interface SetUserStatusInput {
  readonly targetUserId: string;
  readonly status: "pending" | "active" | "deactivated";
  readonly action: string;
  readonly actorUserId: string;
  readonly requestId: string;
}

export interface SetUserAdminInput {
  readonly targetUserId: string;
  readonly isInstanceAdmin: boolean;
  readonly actorUserId: string;
  readonly requestId: string;
}

export interface UpdateSelfNameInput {
  readonly actorUserId: string;
  readonly name: string;
}

export interface RegistrationSettings {
  readonly registrationEnabled: boolean;
  readonly requiresApproval: boolean;
}

export interface SetMemberOnboardingCompleteInput {
  readonly actorUserId: string;
  readonly requestId: string;
}

export interface SetOnboardingStateInput {
  readonly state: Exclude<OnboardingState, "pending">; // only complete/skip are written
  readonly actorUserId: string;
  readonly requestId: string;
}

export type OnboardingProviderKind = "anthropic" | "openai-compatible" | "google";

/** Host usability of each multiplexer, resolved by the composition root (env-aware). */
export interface OnboardingAvailability {
  readonly tmuxUsable: boolean;
  readonly herdrUsable: boolean;
}

/** Pure inputs to the status assembler (no DB, no host I/O, no transaction). */
export interface AssembleOnboardingStatusInput {
  readonly state: OnboardingState;
  readonly selected: ChatMultiplexerChoice | null;
  readonly availability: OnboardingAvailability;
  readonly cliPresentByKind: Readonly<Record<OnboardingProviderKind, boolean>>;
  readonly connectorAccountExists: boolean;
}

const ONBOARDING_CLI_KINDS: readonly OnboardingProviderKind[] = [
  "anthropic",
  "openai-compatible",
  "google"
];

export interface SetModuleDisabledInput {
  readonly moduleId: string;
  readonly disabled: boolean;
  readonly actorUserId: string;
  readonly requestId: string;
}

export class HttpRepositoryError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export class SettingsRepository {
  // No db in constructor — DataContextDb is passed per method via withDataContext.

  async getUserById(scopedDb: DataContextDb, userId: string): Promise<User | undefined> {
    assertDataContextDb(scopedDb);
    const result = await sql<User>`SELECT * FROM app.get_user_by_id(${userId}::uuid)`.execute(
      scopedDb.db
    );
    return result.rows[0];
  }

  async listUsers(scopedDb: DataContextDb): Promise<User[]> {
    assertDataContextDb(scopedDb);
    const result = await sql<User>`SELECT * FROM app.list_all_users()`.execute(scopedDb.db);
    return result.rows;
  }

  async listInstanceSettings(scopedDb: DataContextDb): Promise<InstanceSetting[]> {
    assertDataContextDb(scopedDb);
    return scopedDb.db.selectFrom("app.instance_settings").selectAll().orderBy("key").execute();
  }

  /**
   * All deny rows VISIBLE to the actor under RLS: instance rows (readable by all
   * authed actors — the floor) plus this actor's own user rows (owner-only). Used by
   * the resolver. One SELECT; RLS does the scoping.
   */
  async listModuleDenyRowsForActor(scopedDb: DataContextDb): Promise<ModuleEnablementRow[]> {
    assertDataContextDb(scopedDb);
    return scopedDb.db
      .selectFrom("app.module_enablement")
      .selectAll()
      .orderBy("scope")
      .orderBy("module_id")
      .execute();
  }

  /** Instance rows only (admin GET surface). RLS returns only scope='instance'. */
  async listInstanceModuleDenyRows(scopedDb: DataContextDb): Promise<ModuleEnablementRow[]> {
    assertDataContextDb(scopedDb);
    return scopedDb.db
      .selectFrom("app.module_enablement")
      .selectAll()
      .where("scope", "=", "instance")
      .orderBy("module_id")
      .execute();
  }

  /**
   * Admin: insert (disable) or delete (enable) the instance-scope deny row for a
   * module. Insert is on-conflict-do-nothing (idempotent). Writes an admin audit
   * event recording only the module id + actor + requestId (metadata-only invariant)
   * ONLY when the row actually changed — an idempotent no-op (re-disabling an
   * already-disabled module, or re-enabling one that was never disabled) writes no
   * audit row, so the audit log records real state transitions, not API calls.
   */
  async setInstanceModuleDisabled(
    scopedDb: DataContextDb,
    input: SetModuleDisabledInput
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    let changed: boolean;
    if (input.disabled) {
      const result = await scopedDb.db
        .insertInto("app.module_enablement")
        .values({
          scope: "instance",
          module_id: input.moduleId,
          user_id: null,
          disabled_by_user_id: input.actorUserId,
          created_at: new Date(),
          updated_at: new Date()
        })
        .onConflict((oc) => oc.columns(["module_id"]).where("scope", "=", "instance").doNothing())
        .executeTakeFirst();
      // onConflict-do-nothing yields 0 inserted rows when the row already existed.
      changed = (result?.numInsertedOrUpdatedRows ?? 0n) > 0n;
    } else {
      const result = await scopedDb.db
        .deleteFrom("app.module_enablement")
        .where("scope", "=", "instance")
        .where("module_id", "=", input.moduleId)
        .executeTakeFirst();
      changed = (result?.numDeletedRows ?? 0n) > 0n;
    }

    if (!changed) {
      return;
    }

    await this.insertAuditEvent(scopedDb, {
      actorUserId: input.actorUserId,
      action: input.disabled ? "module.instance_disable" : "module.instance_enable",
      targetType: "module",
      targetId: input.moduleId,
      metadata: { moduleId: input.moduleId },
      requestId: input.requestId
    });
  }

  /**
   * Owner-scoped: insert (disable) or delete (enable) the actor's own user-scope deny
   * row. Self-service is not an admin act — no admin-audit row. RLS WITH CHECK enforces
   * user_id = current actor, so an actor can only ever write their own row.
   */
  async setUserModuleDisabled(
    scopedDb: DataContextDb,
    input: SetModuleDisabledInput
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    if (input.disabled) {
      await scopedDb.db
        .insertInto("app.module_enablement")
        .values({
          scope: "user",
          module_id: input.moduleId,
          user_id: input.actorUserId,
          disabled_by_user_id: input.actorUserId,
          created_at: new Date(),
          updated_at: new Date()
        })
        .onConflict((oc) =>
          oc.columns(["module_id", "user_id"]).where("scope", "=", "user").doNothing()
        )
        .execute();
    } else {
      await scopedDb.db
        .deleteFrom("app.module_enablement")
        .where("scope", "=", "user")
        .where("module_id", "=", input.moduleId)
        .where("user_id", "=", input.actorUserId)
        .execute();
    }
  }

  async upsertInstanceSetting(
    scopedDb: DataContextDb,
    input: UpsertInstanceSettingInput
  ): Promise<InstanceSetting> {
    assertDataContextDb(scopedDb);
    const setting = await scopedDb.db
      .insertInto("app.instance_settings")
      .values({
        key: input.key,
        value: input.value,
        updated_by_user_id: input.updatedByUserId,
        created_at: new Date(),
        updated_at: new Date()
      })
      .onConflict((oc) =>
        oc.column("key").doUpdateSet({
          value: input.value,
          updated_by_user_id: input.updatedByUserId,
          updated_at: new Date()
        })
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.insertAuditEvent(scopedDb, {
      actorUserId: input.updatedByUserId,
      action: input.action ?? "instance_setting.upsert",
      targetType: "instance_setting",
      targetId: input.key,
      requestId: input.requestId,
      metadata: input.metadata ?? { key: input.key }
    });

    return setting;
  }

  async setUserStatus(scopedDb: DataContextDb, input: SetUserStatusInput): Promise<User> {
    assertDataContextDb(scopedDb);
    // GUC already set by withDataContext — no inner tx wrapper, no manual GUC write here.
    const target = await this.requireUserRow(scopedDb, input.targetUserId);

    if (target.is_bootstrap_owner && input.status === "deactivated") {
      throw new HttpRepositoryError(409, "The bootstrap owner cannot be deactivated");
    }
    if (input.status === "deactivated" && input.targetUserId === input.actorUserId) {
      throw new HttpRepositoryError(422, "You cannot deactivate your own account");
    }
    // Re-reads the admin flag under the lock (the `target` read above may be
    // stale); no-ops for non-admins. Guards against deactivating the last admin.
    if (input.status === "deactivated") {
      await this.assertRemovingActiveAdminIsSafe(scopedDb, input.targetUserId);
    }

    const updated = await scopedDb.db
      .updateTable("app.users")
      .set({ status: input.status, updated_at: new Date() })
      .where("id", "=", input.targetUserId)
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.insertAuditEvent(scopedDb, {
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: "user",
      targetId: input.targetUserId,
      metadata: { status: input.status },
      requestId: input.requestId
    });

    return updated;
  }

  async setUserAdmin(scopedDb: DataContextDb, input: SetUserAdminInput): Promise<User> {
    assertDataContextDb(scopedDb);
    // GUC already set by withDataContext — no inner tx wrapper, no manual GUC write here.
    const target = await this.requireUserRow(scopedDb, input.targetUserId);

    if (!input.isInstanceAdmin) {
      if (target.is_bootstrap_owner) {
        throw new HttpRepositoryError(409, "The bootstrap owner cannot be demoted");
      }
      // Re-reads the admin flag under the lock (the `target` read above may be
      // stale); no-ops if the target is not actually an admin.
      await this.assertRemovingActiveAdminIsSafe(scopedDb, input.targetUserId);
    }

    const updated = await scopedDb.db
      .updateTable("app.users")
      .set({ is_instance_admin: input.isInstanceAdmin, updated_at: new Date() })
      .where("id", "=", input.targetUserId)
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.insertAuditEvent(scopedDb, {
      actorUserId: input.actorUserId,
      action: input.isInstanceAdmin ? "user.promote" : "user.demote",
      targetType: "user",
      targetId: input.targetUserId,
      metadata: { isInstanceAdmin: input.isInstanceAdmin },
      requestId: input.requestId
    });

    return updated;
  }

  async updateSelfName(scopedDb: DataContextDb, input: UpdateSelfNameInput): Promise<User> {
    assertDataContextDb(scopedDb);
    return scopedDb.db
      .updateTable("app.users")
      .set({ name: input.name, updated_at: new Date() })
      .where("id", "=", input.actorUserId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getRegistrationSettings(scopedDb: DataContextDb): Promise<RegistrationSettings> {
    assertDataContextDb(scopedDb);
    const rows = await scopedDb.db
      .selectFrom("app.instance_settings")
      .select(["key", "value"])
      .where("key", "in", ["registration.enabled", "registration.requires_approval"])
      .execute();
    const read = (key: string, fallback: boolean): boolean => {
      const val = (rows.find((r) => r.key === key)?.value as { value?: unknown } | undefined)
        ?.value;
      return typeof val === "boolean" ? val : fallback;
    };
    return {
      registrationEnabled: read("registration.enabled", true),
      requiresApproval: read("registration.requires_approval", true)
    };
  }

  async setRegistrationSettings(
    scopedDb: DataContextDb,
    input: RegistrationSettings & { actorUserId: string; requestId: string }
  ): Promise<RegistrationSettings> {
    assertDataContextDb(scopedDb);
    await this.upsertInstanceSetting(scopedDb, {
      key: "registration.enabled",
      value: { value: input.registrationEnabled },
      updatedByUserId: input.actorUserId,
      requestId: input.requestId
    });
    await this.upsertInstanceSetting(scopedDb, {
      key: "registration.requires_approval",
      value: { value: input.requiresApproval },
      updatedByUserId: input.actorUserId,
      requestId: input.requestId
    });
    return {
      registrationEnabled: input.registrationEnabled,
      requiresApproval: input.requiresApproval
    };
  }

  /**
   * Read the calling MEMBER's own onboarding completion timestamp from
   * app.member_onboarding. The table is OWNER-ONLY (self-row RLS, NO admin policy), so
   * even an admin actor sees only its own row — the headline no-admin-bypass invariant
   * for this surface. We filter on app.current_actor_user_id() (NOT a caller-supplied id)
   * for defense in depth: the RLS policy already guarantees only the actor's row is
   * visible, and matching on the GUC means a regressed caller can never even attempt a
   * cross-user read. Returns completedAt: null when the member has no row yet.
   *
   * NOTE: this deliberately does NOT read app.users — app.users carries an admin-wide
   * SELECT policy (0052), so storing/reading onboarding state there would leak it to admins.
   */
  async getMemberOnboardingState(scopedDb: DataContextDb): Promise<{ completedAt: Date | null }> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .selectFrom("app.member_onboarding")
      .select("completed_at")
      .where("user_id", "=", sql<string>`app.current_actor_user_id()`)
      .executeTakeFirst();
    return { completedAt: row?.completed_at ?? null };
  }

  /**
   * Stamp the calling MEMBER's own completed_at = now() in app.member_onboarding, via an
   * UPSERT keyed on app.current_actor_user_id(). The self-row INSERT/UPDATE policies
   * authorize ONLY user_id = current actor; there is NO admin UPDATE policy, so an admin
   * actor cannot stamp another user's row. Idempotent (re-stamping is harmless). We do NOT
   * accept a target user id — the actor is taken from the GUC, closing finding #4 (admin
   * stamping another user's row).
   *
   * NO admin_audit_events row is written. Member onboarding completion is PRIVATE per-user
   * state — the headline invariant of this slice is that "not even an admin may read" it,
   * which is why it lives in an owner-only table with no admin SELECT policy. app.admin_audit_events
   * SELECT is admin-wide (0059), so emitting an "onboarding.member_complete" row keyed to the
   * member would re-leak exactly that protected fact (member X onboarded at time T) through the
   * admin audit log — a side-channel defeating the owner-only table. The durable record of
   * completion IS app.member_onboarding.completed_at on the member's own row; no admin-readable
   * audit is appropriate for a private self-action (cf. memory/chat/connectors, which likewise
   * do not audit per-user private writes to the admin log). The founder's onboarding remains
   * audited because founder onboarding is an instance-global ADMIN action, not private state.
   *
   * `input` ({ actorUserId, requestId }) is retained for AccessContext-shape parity with the
   * other repo writers and possible future per-user (non-admin) audit surface; it is not used to
   * write to the admin log here.
   */
  async setMemberOnboardingComplete(
    scopedDb: DataContextDb,
    input: SetMemberOnboardingCompleteInput
  ): Promise<{ completedAt: Date | null }> {
    assertDataContextDb(scopedDb);
    void input; // intentionally not written to the admin-readable audit log (see doc above).
    const now = new Date();
    // UPSERT keyed on the GUC actor id — never on a caller-supplied target. The INSERT WITH
    // CHECK and UPDATE USING/WITH CHECK both require user_id = app.current_actor_user_id(),
    // so this only ever touches the actor's own row.
    const upserted = await scopedDb.db
      .insertInto("app.member_onboarding")
      .values({
        user_id: sql<string>`app.current_actor_user_id()`,
        completed_at: now,
        created_at: now,
        updated_at: now
      })
      .onConflict((oc) => oc.column("user_id").doUpdateSet({ completed_at: now, updated_at: now }))
      .returning("completed_at")
      .executeTakeFirst();

    return { completedAt: upserted?.completed_at ?? null };
  }

  async getChatMultiplexerSetting(
    scopedDb: DataContextDb
  ): Promise<{ multiplexer: ChatMultiplexerChoice }> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .selectFrom("app.instance_settings")
      .select("value")
      .where("key", "=", "chat.multiplexer")
      .executeTakeFirst();
    const raw = (row?.value as { value?: unknown } | undefined)?.value;
    return { multiplexer: raw === "tmux" || raw === "herdr" ? raw : "auto" };
  }

  async setChatMultiplexerSetting(
    scopedDb: DataContextDb,
    input: { multiplexer: ChatMultiplexerChoice; actorUserId: string; requestId: string }
  ): Promise<{ multiplexer: ChatMultiplexerChoice }> {
    assertDataContextDb(scopedDb);
    await this.upsertInstanceSetting(scopedDb, {
      key: "chat.multiplexer",
      value: { value: input.multiplexer },
      updatedByUserId: input.actorUserId,
      requestId: input.requestId
    });
    return { multiplexer: input.multiplexer };
  }

  /** Read the single onboarding lifecycle state (default "pending" when absent). */
  async readOnboardingState(scopedDb: DataContextDb): Promise<OnboardingState> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .selectFrom("app.instance_settings")
      .select("value")
      .where("key", "=", "onboarding.state")
      .executeTakeFirst();
    const raw = (row?.value as { value?: unknown } | undefined)?.value;
    return raw === "completed" || raw === "skipped" ? raw : "pending";
  }

  /**
   * Set onboarding.state to "completed" or "skipped" through the shared audited upsert
   * helper with an ACTION OVERRIDE, so there is exactly ONE audit row carrying the
   * specific verb ("onboarding.complete"/"onboarding.skip"). A single enum key means the
   * terminal state is never ambiguous (the prior two-boolean design allowed completed &&
   * skipped both true); skip overwrites completed and vice-versa.
   */
  async setOnboardingState(
    scopedDb: DataContextDb,
    input: SetOnboardingStateInput
  ): Promise<OnboardingState> {
    assertDataContextDb(scopedDb);
    await this.upsertInstanceSetting(scopedDb, {
      key: "onboarding.state",
      value: { value: input.state },
      updatedByUserId: input.actorUserId,
      requestId: input.requestId,
      action: input.state === "completed" ? "onboarding.complete" : "onboarding.skip",
      metadata: { state: input.state }
    });
    return input.state;
  }

  /** Read the persisted chat.multiplexer choice, or null when no row exists (fresh instance). */
  async readChatMultiplexerChoiceOrNull(
    scopedDb: DataContextDb
  ): Promise<ChatMultiplexerChoice | null> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .selectFrom("app.instance_settings")
      .select("value")
      .where("key", "=", "chat.multiplexer")
      .executeTakeFirst();
    if (!row) return null;
    const raw = (row.value as { value?: unknown } | undefined)?.value;
    return raw === "auto" || raw === "tmux" || raw === "herdr" ? raw : null;
  }

  /**
   * PURE derivation of onboarding status — no DB, no host probes, no transaction. The route
   * supplies the persisted state + selected choice (from a DB read), the host availability
   * snapshot, the per-provider CLI presence, and the connector-exists bool. Derived `done`:
   *  - multiplexer.done ⇔ the SELECTED choice is USABLE on this host:
   *       "tmux"  ⇒ tmuxUsable ; "herdr" ⇒ herdrUsable ; "auto" ⇒ tmuxUsable || herdrUsable.
   *     A null selection (no chat.multiplexer row yet) ⇒ not done. Bare binary presence is
   *     NOT enough for herdr (it needs a root pane) — usability is decided upstream.
   *  - cliAuth.done ⇔ at least one provider CLI is PRESENT (presence ≠ authenticated; floor).
   *  - connectors.done ⇔ a connector account exists.
   * The `satisfies OnboardingFounderStatus` makes contract drift a compile error (Codex R1).
   * Phase 4: this assembler builds ONLY the founder variant of the role-tagged status union;
   * the member branch is served separately from app.member_onboarding.
   */
  assembleOnboardingStatus(input: AssembleOnboardingStatusInput): OnboardingFounderStatus {
    const { state, selected, availability, cliPresentByKind, connectorAccountExists } = input;

    const multiplexerDone =
      selected === "tmux"
        ? availability.tmuxUsable
        : selected === "herdr"
          ? availability.herdrUsable
          : selected === "auto"
            ? availability.tmuxUsable || availability.herdrUsable
            : false;

    const providers = ONBOARDING_CLI_KINDS.map((kind) => ({
      kind,
      cliPresent: cliPresentByKind[kind]
    }));

    return {
      // Phase 4: tag the founder variant of the role-discriminated OnboardingStatusResponse.
      role: "founder",
      state,
      steps: {
        multiplexer: {
          done: multiplexerDone,
          selected,
          tmuxUsable: availability.tmuxUsable,
          herdrUsable: availability.herdrUsable
        },
        cliAuth: {
          done: providers.some((p) => p.cliPresent),
          providers
        },
        connectors: { done: connectorAccountExists }
      }
    } satisfies OnboardingFounderStatus;
  }

  async listAdminAuditEvents(scopedDb: DataContextDb): Promise<AdminAuditEvent[]> {
    assertDataContextDb(scopedDb);
    return scopedDb.db
      .selectFrom("app.admin_audit_events")
      .selectAll()
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(50)
      .execute();
  }

  async assertNotLastActiveAdmin(scopedDb: DataContextDb, excludingUserId: string): Promise<void> {
    assertDataContextDb(scopedDb);
    await this.assertAnotherActiveAdmin(scopedDb, excludingUserId);
  }

  private async requireUserRow(scopedDb: DataContextDb, userId: string): Promise<User> {
    const result = await sql<User>`SELECT * FROM app.get_user_by_id(${userId}::uuid)`.execute(
      scopedDb.db
    );
    const user = result.rows[0];
    if (!user) {
      throw new HttpRepositoryError(404, "User not found");
    }
    return user;
  }

  /**
   * Serialize last-active-admin checks against any other admin-removing mutation.
   * withDataContext runs each repository method inside a single transaction, so
   * this transaction-scoped advisory lock is held through the caller's subsequent
   * UPDATE and commit. The same key is taken by the bootstrap-connection delete
   * path (scripts/delete-user-data.ts) — advisory locks are per-database, so all
   * removal paths serialize. Mirrors the bootstrapFirstJarvisUser pattern
   * (auth/src/index.ts). (#94)
   */
  private async lockLastActiveAdmin(scopedDb: DataContextDb): Promise<void> {
    await sql`SELECT pg_advisory_xact_lock(hashtext('jarv1s:last-active-admin'))`.execute(
      scopedDb.db
    );
  }

  /** Throws 409 unless an active admin other than excludingUserId exists. Assumes the lock is held. */
  private async ensureAnotherActiveAdminExists(
    scopedDb: DataContextDb,
    excludingUserId: string
  ): Promise<void> {
    const result = await sql<{ id: string }>`
      SELECT id FROM app.list_all_users()
      WHERE is_instance_admin = true AND status = 'active' AND id != ${excludingUserId}::uuid
      LIMIT 1
    `.execute(scopedDb.db);
    if (!result.rows[0]) {
      throw new HttpRepositoryError(409, "Cannot remove the last active admin");
    }
  }

  /**
   * Take the lock, then count under it. For callers (the route delete/reject
   * pre-checks) that have already established the target is an admin.
   */
  private async assertAnotherActiveAdmin(
    scopedDb: DataContextDb,
    excludingUserId: string
  ): Promise<void> {
    await this.lockLastActiveAdmin(scopedDb);
    await this.ensureAnotherActiveAdminExists(scopedDb, excludingUserId);
  }

  /**
   * Guard a deactivate/demote of targetUserId. Takes the lock FIRST, then
   * re-reads the target's admin flag under the lock — so a stale "not an admin"
   * read taken before the lock (e.g. racing a concurrent promote) can never skip
   * the guard. Only when the target is genuinely an admin do we require another
   * active admin to remain. (#94)
   */
  private async assertRemovingActiveAdminIsSafe(
    scopedDb: DataContextDb,
    targetUserId: string
  ): Promise<void> {
    await this.lockLastActiveAdmin(scopedDb);
    const target = await this.requireUserRow(scopedDb, targetUserId);
    if (!target.is_instance_admin) {
      return;
    }
    await this.ensureAnotherActiveAdminExists(scopedDb, targetUserId);
  }

  async insertAuditEvent(
    scopedDb: DataContextDb,
    input: {
      readonly actorUserId: string;
      readonly action: string;
      readonly targetType: string;
      readonly targetId: string | null;
      readonly metadata: Record<string, unknown>;
      readonly requestId: string;
    }
  ): Promise<void> {
    await scopedDb.db
      .insertInto("app.admin_audit_events")
      .values({
        id: randomUUID(),
        actor_user_id: input.actorUserId,
        action: input.action,
        target_type: input.targetType,
        target_id: input.targetId,
        metadata: input.metadata,
        request_id: input.requestId,
        created_at: new Date()
      })
      .execute();
  }
}

/**
 * Public cross-module API for recording admin audit events.
 * Called by packages/auth via @jarv1s/settings — auth must never import
 * SettingsRepository directly or write app.admin_audit_events directly.
 */
export async function recordAuditEvent(
  scopedDb: DataContextDb,
  event: {
    readonly actorUserId: string;
    readonly action: string;
    readonly targetType: string; // NOT NULL in schema — always required
    readonly targetId: string;
    readonly metadata: Record<string, unknown>;
    readonly requestId: string;
  }
): Promise<void> {
  assertDataContextDb(scopedDb);
  await new SettingsRepository().insertAuditEvent(scopedDb, event);
}
