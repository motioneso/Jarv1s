import { sql } from "kysely";

import {
  assertDataContextDb,
  type DataContextDb,
  type UsefulnessFeedbackKind,
  type UsefulnessFeedbackSignal
} from "@jarv1s/db";
import type { FeedbackSurface, FeedbackTargetKind } from "@jarv1s/shared";

import type { FeedbackTargetVerification } from "./target-verifiers.js";

interface FeedbackRow {
  readonly id: string;
  readonly owner_user_id: string;
  readonly target_kind: FeedbackTargetKind;
  readonly target_ref: string;
  readonly surface: FeedbackSurface;
  readonly kind: UsefulnessFeedbackKind;
  readonly source_kind: string | null;
  readonly source_label: string | null;
  readonly priority_band: "critical" | "high" | "normal" | "low" | null;
  readonly effect_kind: string | null;
  readonly effect_ref: string | null;
  readonly metadata_json: Record<string, unknown>;
  readonly status: "active" | "undone";
  readonly created_at: Date;
  readonly resolved_at: Date | null;
}

export interface CreateFeedbackInput {
  readonly ownerUserId: string;
  readonly targetKind: FeedbackTargetKind;
  readonly targetRef: string;
  readonly surface: FeedbackSurface;
  readonly kind: UsefulnessFeedbackKind;
  readonly verification: FeedbackTargetVerification;
  readonly metadata: Record<string, unknown>;
  readonly effectKind?: string | null;
  readonly effectRef?: string | null;
}

export class UsefulnessFeedbackRepository {
  async findActive(
    scopedDb: DataContextDb,
    ownerUserId: string,
    targetKind: FeedbackTargetKind,
    targetRef: string,
    kind: UsefulnessFeedbackKind
  ): Promise<UsefulnessFeedbackSignal | undefined> {
    assertDataContextDb(scopedDb);
    return scopedDb.db
      .selectFrom("app.usefulness_feedback_signals")
      .selectAll()
      .where("owner_user_id", "=", ownerUserId)
      .where("target_kind", "=", targetKind)
      .where("target_ref", "=", targetRef)
      .where("kind", "=", kind)
      .where("status", "=", "active")
      .executeTakeFirst();
  }

  async create(
    scopedDb: DataContextDb,
    input: CreateFeedbackInput
  ): Promise<UsefulnessFeedbackSignal> {
    assertDataContextDb(scopedDb);
    const result = await sql<FeedbackRow>`
      INSERT INTO app.usefulness_feedback_signals (
        owner_user_id,
        target_kind,
        target_ref,
        surface,
        kind,
        source_kind,
        source_label,
        priority_band,
        effect_kind,
        effect_ref,
        metadata_json
      )
      VALUES (
        ${input.ownerUserId}::uuid,
        ${input.targetKind},
        ${input.targetRef},
        ${input.surface},
        ${input.kind},
        ${input.verification.sourceKind ?? null},
        ${input.verification.sourceLabel ?? null},
        ${input.verification.priorityBand ?? null},
        ${input.effectKind ?? null},
        ${input.effectRef ?? null},
        ${JSON.stringify(input.metadata)}::jsonb
      )
      RETURNING *
    `.execute(scopedDb.db);

    const row = result.rows[0];
    if (!row) throw new Error("usefulness feedback insert returned no row");
    return row;
  }

  async list(scopedDb: DataContextDb, ownerUserId: string): Promise<UsefulnessFeedbackSignal[]> {
    assertDataContextDb(scopedDb);
    return scopedDb.db
      .selectFrom("app.usefulness_feedback_signals")
      .selectAll()
      .where("owner_user_id", "=", ownerUserId)
      .orderBy("created_at", "desc")
      .orderBy("id")
      .limit(100)
      .execute();
  }

  async upsertTarget(
    scopedDb: DataContextDb,
    input: {
      readonly ownerUserId: string;
      readonly targetKind: FeedbackTargetKind;
      readonly targetRef: string;
      readonly surface: FeedbackSurface;
      readonly sourceKind?: string | null;
      readonly sourceLabel?: string | null;
      readonly priorityBand?: "critical" | "high" | "normal" | "low" | null;
      readonly metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    await sql`
      INSERT INTO app.usefulness_feedback_targets (
        owner_user_id,
        target_kind,
        target_ref,
        surface,
        source_kind,
        source_label,
        priority_band,
        metadata_json,
        last_seen_at
      )
      VALUES (
        ${input.ownerUserId}::uuid,
        ${input.targetKind},
        ${input.targetRef},
        ${input.surface},
        ${input.sourceKind ?? null},
        ${input.sourceLabel ?? null},
        ${input.priorityBand ?? null},
        ${JSON.stringify(input.metadata ?? {})}::jsonb,
        now()
      )
      ON CONFLICT (owner_user_id, target_kind, target_ref, surface) DO UPDATE
      SET source_kind = EXCLUDED.source_kind,
          source_label = EXCLUDED.source_label,
          priority_band = EXCLUDED.priority_band,
          metadata_json = EXCLUDED.metadata_json,
          last_seen_at = now()
    `.execute(scopedDb.db);
  }

  async findTarget(
    scopedDb: DataContextDb,
    ownerUserId: string,
    targetKind: FeedbackTargetKind,
    targetRef: string,
    surface: FeedbackSurface
  ): Promise<{
    readonly owner_user_id: string;
    readonly target_kind: FeedbackTargetKind;
    readonly target_ref: string;
    readonly surface: FeedbackSurface;
    readonly source_kind: string | null;
    readonly source_label: string | null;
    readonly priority_band: "critical" | "high" | "normal" | "low" | null;
    readonly metadata_json: Record<string, unknown>;
  } | null> {
    assertDataContextDb(scopedDb);
    const result = await sql<{
      readonly owner_user_id: string;
      readonly target_kind: FeedbackTargetKind;
      readonly target_ref: string;
      readonly surface: FeedbackSurface;
      readonly source_kind: string | null;
      readonly source_label: string | null;
      readonly priority_band: "critical" | "high" | "normal" | "low" | null;
      readonly metadata_json: Record<string, unknown>;
    }>`
      SELECT owner_user_id, target_kind, target_ref, surface, source_kind, source_label,
             priority_band, metadata_json
      FROM app.usefulness_feedback_targets
      WHERE owner_user_id = ${ownerUserId}::uuid
        AND target_kind = ${targetKind}
        AND target_ref = ${targetRef}
        AND surface = ${surface}
    `.execute(scopedDb.db);
    return result.rows[0] ?? null;
  }

  async listActiveDismissedRefs(
    scopedDb: DataContextDb,
    ownerUserId: string,
    targetKind: FeedbackTargetKind,
    surface: FeedbackSurface
  ): Promise<Set<string>> {
    assertDataContextDb(scopedDb);
    const result = await sql<{ target_ref: string }>`
      SELECT target_ref
      FROM app.usefulness_feedback_signals
      WHERE owner_user_id = ${ownerUserId}::uuid
        AND target_kind = ${targetKind}
        AND surface = ${surface}
        AND kind = 'dismiss'
        AND status = 'active'
    `.execute(scopedDb.db);
    return new Set(result.rows.map((row) => row.target_ref));
  }

  async undo(
    scopedDb: DataContextDb,
    ownerUserId: string,
    id: string,
    options: {
      readonly cancelMemoryCandidate?: (candidateId: string) => Promise<boolean>;
      readonly undoDismissCard?: (cardId: string) => Promise<void>;
    } = {}
  ): Promise<UsefulnessFeedbackSignal | undefined> {
    assertDataContextDb(scopedDb);
    const existing = await scopedDb.db
      .selectFrom("app.usefulness_feedback_signals")
      .selectAll()
      .where("owner_user_id", "=", ownerUserId)
      .where("id", "=", id)
      .executeTakeFirst();
    if (!existing) return undefined;
    if (existing.status === "undone") return existing;
    if (existing.effect_kind === "memory_candidate" && existing.effect_ref) {
      await options.cancelMemoryCandidate?.(existing.effect_ref);
    }
    if (existing.effect_kind === "proactive_card_dismissed" && existing.effect_ref) {
      await options.undoDismissCard?.(existing.effect_ref);
    }
    return scopedDb.db
      .updateTable("app.usefulness_feedback_signals")
      .set({ status: "undone", resolved_at: new Date() })
      .where("owner_user_id", "=", ownerUserId)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }
}
