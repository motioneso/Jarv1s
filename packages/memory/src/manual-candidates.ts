import { createHash } from "node:crypto";

import { sql } from "kysely";

import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";

import type { MemoryCandidateRecord } from "./candidates-repository.js";

interface CandidateRow {
  readonly id: string;
  readonly owner_user_id: string;
  readonly episode_id: string | null;
  readonly kind: MemoryCandidateRecord["kind"];
  readonly action: MemoryCandidateRecord["action"];
  readonly payload_json: unknown;
  readonly candidate_signature: string;
  readonly status: MemoryCandidateRecord["status"];
  readonly confidence: string | number;
  readonly importance: string | number;
  readonly provenance: MemoryCandidateRecord["provenance"];
  readonly promotion_reason: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly resolved_at: Date | null;
}

export interface ManualMemoryCandidateInput {
  readonly targetKind: string;
  readonly targetRef: string;
  readonly excerpt: string;
  readonly episodeId?: string | null;
  readonly provenance?: "volunteered" | "inferred";
}

export class ManualMemoryCandidateService {
  async createPendingManualCandidate(
    scopedDb: DataContextDb,
    ownerUserId: string,
    input: ManualMemoryCandidateInput
  ): Promise<MemoryCandidateRecord> {
    assertDataContextDb(scopedDb);
    const excerpt = input.excerpt.replace(/\s+/g, " ").trim().slice(0, 1000);
    if (!excerpt) throw new Error("manual memory candidate requires excerpt");
    const candidateSignature = `manual:${hashManualSignature(
      input.targetKind,
      input.targetRef,
      excerpt
    )}`;
    const payloadJson = {
      manualRequest: true,
      excerpt,
      targetKind: input.targetKind,
      targetRef: input.targetRef
    };

    const result = await sql<CandidateRow>`
      INSERT INTO app.memory_candidates (
        owner_user_id,
        episode_id,
        kind,
        action,
        payload_json,
        candidate_signature,
        confidence,
        importance,
        provenance
      )
      VALUES (
        ${ownerUserId}::uuid,
        ${input.episodeId ?? null}::uuid,
        'fact',
        'create',
        ${JSON.stringify(payloadJson)}::jsonb,
        ${candidateSignature},
        0.5,
        0.5,
        ${input.provenance ?? "volunteered"}
      )
      ON CONFLICT (owner_user_id, candidate_signature) DO UPDATE
      SET status = 'pending',
          payload_json = EXCLUDED.payload_json,
          promotion_reason = NULL,
          resolved_at = NULL,
          updated_at = now()
      RETURNING *
    `.execute(scopedDb.db);

    const row = result.rows[0];
    if (!row) throw new Error("manual memory candidate insert returned no row");
    return mapCandidate(row);
  }

  async cancelPendingManualCandidate(
    scopedDb: DataContextDb,
    ownerUserId: string,
    id: string
  ): Promise<boolean> {
    assertDataContextDb(scopedDb);
    const result = await sql<{ id: string }>`
      UPDATE app.memory_candidates
      SET status = 'suppressed',
          promotion_reason = 'usefulness_feedback_undone',
          resolved_at = now(),
          updated_at = now()
      WHERE owner_user_id = ${ownerUserId}::uuid
        AND id = ${id}::uuid
        AND status = 'pending'
      RETURNING id
    `.execute(scopedDb.db);
    return result.rows.length > 0;
  }
}

function hashManualSignature(targetKind: string, targetRef: string, excerpt: string): string {
  return createHash("sha256")
    .update([targetKind, targetRef, excerpt.toLowerCase()].join("|"))
    .digest("hex");
}

function mapCandidate(row: CandidateRow): MemoryCandidateRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    episodeId: row.episode_id,
    kind: row.kind,
    action: row.action,
    payloadJson: row.payload_json,
    candidateSignature: row.candidate_signature,
    status: row.status,
    confidence: Number(row.confidence),
    importance: Number(row.importance),
    provenance: row.provenance,
    promotionReason: row.promotion_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at
  };
}
