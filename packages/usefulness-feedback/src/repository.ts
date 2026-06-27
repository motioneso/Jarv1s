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

  async undo(
    scopedDb: DataContextDb,
    ownerUserId: string,
    id: string,
    options: { readonly cancelMemoryCandidate?: (candidateId: string) => Promise<boolean> } = {}
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
    return scopedDb.db
      .updateTable("app.usefulness_feedback_signals")
      .set({ status: "undone", resolved_at: new Date() })
      .where("owner_user_id", "=", ownerUserId)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }
}
