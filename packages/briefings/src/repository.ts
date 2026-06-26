import { randomUUID } from "node:crypto";

import { sql, type Updateable } from "kysely";

import { findAssistantToolFromManifests } from "@jarv1s/ai";
import {
  assertDataContextDb,
  type BriefingCadence,
  type BriefingDefinition,
  type BriefingDefinitionsTable,
  type BriefingRun,
  type BriefingRunKind,
  type BriefingRunStatus,
  type BriefingType,
  type DataContextDb
} from "@jarv1s/db";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";

import { composeBriefing, type ComposeDeps } from "./compose.js";
import { defaultScheduleMetadataFor, timezoneFor } from "./schedule.js";

export interface CreateBriefingDefinitionInput {
  readonly title: string;
  readonly briefingType?: BriefingType;
  readonly cadence?: BriefingCadence;
  readonly scheduleMetadata?: Record<string, unknown>;
  readonly enabled?: boolean;
  readonly selectedToolNames: readonly string[];
}

export interface UpdateBriefingDefinitionInput {
  readonly title?: string;
  readonly briefingType?: BriefingType;
  readonly cadence?: BriefingCadence;
  readonly scheduleMetadata?: Record<string, unknown>;
  readonly enabled?: boolean;
  readonly selectedToolNames?: readonly string[];
}

export interface GenerateBriefingRunInput {
  readonly moduleManifests: readonly JarvisModuleManifest[];
  readonly runKind: BriefingRunKind;
  readonly runId?: string;
  /**
   * pg-boss job ID when this run is triggered by a worker job.
   * Used to form the requestId in ToolContext so execution is traceable.
   */
  readonly jobId?: string;
  /**
   * Synthesis dependencies (AI repository, credential cipher, memory retriever,
   * module manifests). Required — the only production caller is the briefings
   * worker, which always builds these. The deterministic degraded fallback lives
   * inside `compose.ts`, so there is no provider-less variant here.
   */
  readonly composeDeps: ComposeDeps;
}

export class BriefingsRepository {
  async listDefinitions(scopedDb: DataContextDb): Promise<BriefingDefinition[]> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.briefing_definitions")
      .selectAll()
      .orderBy("updated_at", "desc")
      .orderBy("id")
      .execute();
  }

  async getDefinitionById(
    scopedDb: DataContextDb,
    definitionId: string
  ): Promise<BriefingDefinition | undefined> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.briefing_definitions")
      .selectAll()
      .where("id", "=", definitionId)
      .executeTakeFirst();
  }

  async createDefinition(
    scopedDb: DataContextDb,
    input: CreateBriefingDefinitionInput
  ): Promise<BriefingDefinition> {
    assertDataContextDb(scopedDb);

    const now = new Date();
    const briefingType = input.briefingType ?? "morning";

    return scopedDb.db
      .insertInto("app.briefing_definitions")
      .values({
        id: randomUUID(),
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        title: input.title,
        briefing_type: briefingType,
        cadence: input.cadence ?? "manual",
        schedule_metadata: input.scheduleMetadata ?? defaultScheduleMetadataFor(briefingType),
        enabled: input.enabled ?? true,
        selected_tool_names: [...input.selectedToolNames],
        last_run_at: null,
        created_at: now,
        updated_at: now
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateDefinition(
    scopedDb: DataContextDb,
    definitionId: string,
    input: UpdateBriefingDefinitionInput
  ): Promise<BriefingDefinition | undefined> {
    assertDataContextDb(scopedDb);

    const updates: Updateable<BriefingDefinitionsTable> = {
      updated_at: new Date()
    };

    if (input.title !== undefined) {
      updates.title = input.title;
    }
    if (input.briefingType !== undefined) {
      updates.briefing_type = input.briefingType;
    }
    if (input.cadence !== undefined) {
      updates.cadence = input.cadence;
    }
    if (input.scheduleMetadata !== undefined) {
      updates.schedule_metadata = input.scheduleMetadata;
    }
    if (input.enabled !== undefined) {
      updates.enabled = input.enabled;
    }
    if (input.selectedToolNames !== undefined) {
      updates.selected_tool_names = [...input.selectedToolNames];
    }

    return scopedDb.db
      .updateTable("app.briefing_definitions")
      .set(updates)
      .where("id", "=", definitionId)
      .returningAll()
      .executeTakeFirst();
  }

  async listRuns(scopedDb: DataContextDb, definitionId: string): Promise<BriefingRun[]> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.briefing_runs")
      .selectAll()
      .where("definition_id", "=", definitionId)
      .orderBy("created_at", "desc")
      .orderBy("id")
      .execute();
  }

  async getOwnedEveningRunForInterview(
    scopedDb: DataContextDb,
    runId?: string
  ): Promise<BriefingRun | undefined> {
    assertDataContextDb(scopedDb);

    let query = scopedDb.db
      .selectFrom("app.briefing_runs")
      .selectAll()
      .where("owner_user_id", "=", sql<string>`app.current_actor_user_id()`)
      .where("briefing_type", "=", "evening");
    if (runId) {
      query = query.where("id", "=", runId);
    }

    return query.orderBy("created_at", "desc").orderBy("id").executeTakeFirst();
  }

  /** `created:false` means an existing same-day scheduled run was returned (idempotent skip). */
  async generateRun(
    scopedDb: DataContextDb,
    definitionId: string,
    input: GenerateBriefingRunInput
  ): Promise<{ run: BriefingRun; created: boolean } | undefined> {
    assertDataContextDb(scopedDb);

    const definition = await this.getOwnedDefinitionById(scopedDb, definitionId);
    if (!definition) {
      return undefined;
    }

    // Capture ONE `now` so the lock-day, the existing-run comparison, and compose's
    // local-day window all agree even across a local-midnight boundary.
    const now = new Date();

    // Scheduled local-day idempotency under a transaction-scoped advisory lock so two
    // concurrent cron fires (multi-replica worker, or a retry overlapping the first)
    // cannot both pass check-then-insert (F2). `scopedDb.db` is ALREADY the Kysely
    // Transaction opened by withDataContext (DataContextDb.db: Transaction<...>), so we
    // take the lock ON that existing transaction — do NOT open a nested transaction. The
    // lock auto-releases when withDataContext's transaction commits/rolls back.
    //
    // This runs BEFORE the blocked-tool guard so a blocked SCHEDULED definition is also
    // deduped: the idempotency check matches any same-local-day scheduled run regardless
    // of status, so a persisted `blocked` run suppresses every later fire that day rather
    // than orphaning a fresh blocked row on each cron tick.
    if (input.runKind === "scheduled") {
      // hashtextextended(text, 0) → stable bigint key per (definition, local day).
      const lockKey = `${definition.id}:${localDayString(definition, now)}`;
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`.execute(scopedDb.db);
      const existing = await this.findScheduledRunForLocalDay(scopedDb, definition, now);
      if (existing) {
        return { run: existing, created: false };
      }
    }

    // Blocked-tool guard preserved: a non-read selected tool blocks the run.
    const blocked = definition.selected_tool_names.some((name) => {
      const tool = findAssistantToolFromManifests(input.composeDeps.moduleManifests, name);
      return !tool || tool.risk !== "read";
    });
    if (blocked) {
      const run = await this.persistRun(scopedDb, definition, input, {
        status: "blocked",
        summaryText: "Briefing blocked because selected tools are not all declared read tools.",
        sourceMetadata: { degraded: false, gaps: [], blockedReason: "non_read_tool" }
      });
      return { run, created: true };
    }

    const composed = await composeBriefing(
      scopedDb,
      definition,
      {
        runKind: input.runKind,
        runId: input.runId,
        jobId: input.jobId,
        now
      },
      input.composeDeps
    );
    const run = await this.persistRun(scopedDb, definition, input, composed);
    return { run, created: true };
  }

  private async persistRun(
    scopedDb: DataContextDb,
    definition: BriefingDefinition,
    input: GenerateBriefingRunInput,
    composed: {
      status: BriefingRunStatus;
      summaryText: string;
      sourceMetadata: Record<string, unknown>;
    }
  ): Promise<BriefingRun> {
    const createdAt = new Date();
    const run = await scopedDb.db
      .insertInto("app.briefing_runs")
      .values({
        id: input.runId ?? randomUUID(),
        definition_id: definition.id,
        owner_user_id: definition.owner_user_id,
        status: composed.status,
        run_kind: input.runKind,
        briefing_type: definition.briefing_type,
        summary_text: composed.summaryText,
        source_metadata: composed.sourceMetadata,
        created_at: createdAt
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await scopedDb.db
      .updateTable("app.briefing_definitions")
      .set({ last_run_at: createdAt, updated_at: createdAt })
      .where("id", "=", definition.id)
      .execute();

    return run;
  }

  private async findScheduledRunForLocalDay(
    scopedDb: DataContextDb,
    definition: BriefingDefinition,
    now: Date
  ): Promise<BriefingRun | undefined> {
    const timeZone = timezoneFor(definition.schedule_metadata);
    const localDate = (d: Date): string =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(d);
    const today = localDayString(definition, now);

    const recent = await scopedDb.db
      .selectFrom("app.briefing_runs")
      .selectAll()
      .where("definition_id", "=", definition.id)
      .where("run_kind", "=", "scheduled")
      .orderBy("created_at", "desc")
      .limit(5)
      .execute();

    return recent.find((run) => {
      const created = run.created_at instanceof Date ? run.created_at : new Date(run.created_at);
      return localDate(created) === today;
    });
  }

  async getOwnedDefinitionById(
    scopedDb: DataContextDb,
    definitionId: string
  ): Promise<BriefingDefinition | undefined> {
    assertDataContextDb(scopedDb);
    return scopedDb.db
      .selectFrom("app.briefing_definitions")
      .selectAll()
      .where("id", "=", definitionId)
      .where("owner_user_id", "=", sql<string>`app.current_actor_user_id()`)
      .executeTakeFirst();
  }
}

/** Local calendar-day string ("YYYY-MM-DD") for `now` in the definition's IANA tz. */
function localDayString(definition: BriefingDefinition, now: Date): string {
  const timeZone = timezoneFor(definition.schedule_metadata);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}
