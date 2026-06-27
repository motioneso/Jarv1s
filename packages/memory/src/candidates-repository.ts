import { createHash } from "node:crypto";

import { sql } from "kysely";

import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";

export type MemoryCandidateKind = "entity" | "fact" | "alias" | "supersession" | "conflict";
export type MemoryCandidateAction = "create" | "update" | "link" | "supersede" | "reject";
export type MemoryCandidateStatus = "pending" | "promoted" | "rejected" | "merged" | "suppressed";
export type MemoryCandidateProvenance = "volunteered" | "inferred";

export interface MemoryCandidateRecord {
  readonly id: string;
  readonly ownerUserId: string;
  readonly episodeId: string | null;
  readonly kind: MemoryCandidateKind;
  readonly action: MemoryCandidateAction;
  readonly payloadJson: unknown;
  readonly candidateSignature: string;
  readonly status: MemoryCandidateStatus;
  readonly confidence: number;
  readonly importance: number;
  readonly provenance: MemoryCandidateProvenance;
  readonly promotionReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly resolvedAt: Date | null;
}

export interface NewMemoryCandidate {
  readonly episodeId?: string | null;
  readonly kind: MemoryCandidateKind;
  readonly action: MemoryCandidateAction;
  readonly payloadJson: unknown;
  readonly candidateSignature: string;
  readonly confidence: number;
  readonly importance: number;
  readonly provenance: MemoryCandidateProvenance;
}

export interface MemoryCandidateSignatureInput {
  readonly kind: MemoryCandidateKind;
  readonly action: MemoryCandidateAction;
  readonly entity?: { readonly name?: string };
  readonly fact?: {
    readonly subject?: string;
    readonly predicate?: string;
    readonly objectText?: string;
    readonly objectName?: string;
  };
  readonly alias?: { readonly alias?: string; readonly targetName?: string };
}

interface CandidateRow {
  readonly id: string;
  readonly owner_user_id: string;
  readonly episode_id: string | null;
  readonly kind: MemoryCandidateKind;
  readonly action: MemoryCandidateAction;
  readonly payload_json: unknown;
  readonly candidate_signature: string;
  readonly status: MemoryCandidateStatus;
  readonly confidence: string | number;
  readonly importance: string | number;
  readonly provenance: MemoryCandidateProvenance;
  readonly promotion_reason: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly resolved_at: Date | null;
}

export class MemoryCandidatesRepository {
  async insertPending(
    scopedDb: DataContextDb,
    ownerUserId: string,
    input: NewMemoryCandidate
  ): Promise<MemoryCandidateRecord> {
    assertDataContextDb(scopedDb);
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
        ${input.kind},
        ${input.action},
        ${JSON.stringify(input.payloadJson)}::jsonb,
        ${input.candidateSignature},
        ${clamp01(input.confidence)},
        ${clamp01(input.importance)},
        ${input.provenance}
      )
      ON CONFLICT (owner_user_id, candidate_signature) DO UPDATE
      SET candidate_signature = app.memory_candidates.candidate_signature
      RETURNING *
    `.execute(scopedDb.db);

    const row = result.rows[0];
    if (!row) throw new Error("insertPending returned no row");
    return mapCandidate(row);
  }

  async markPromoted(
    scopedDb: DataContextDb,
    ownerUserId: string,
    id: string,
    reason: string
  ): Promise<boolean> {
    return this.#mark(scopedDb, ownerUserId, id, "promoted", reason);
  }

  async markRejected(
    scopedDb: DataContextDb,
    ownerUserId: string,
    id: string,
    reason: string
  ): Promise<boolean> {
    return this.#mark(scopedDb, ownerUserId, id, "rejected", reason);
  }

  async findBySignature(
    scopedDb: DataContextDb,
    ownerUserId: string,
    signature: string
  ): Promise<MemoryCandidateRecord | undefined> {
    assertDataContextDb(scopedDb);
    const result = await sql<CandidateRow>`
      SELECT *
      FROM app.memory_candidates
      WHERE owner_user_id = ${ownerUserId}::uuid
        AND candidate_signature = ${signature}
    `.execute(scopedDb.db);
    return result.rows[0] ? mapCandidate(result.rows[0]) : undefined;
  }

  async listPending(
    scopedDb: DataContextDb,
    ownerUserId: string,
    limit: number
  ): Promise<MemoryCandidateRecord[]> {
    assertDataContextDb(scopedDb);
    const result = await sql<CandidateRow>`
      SELECT *
      FROM app.memory_candidates
      WHERE owner_user_id = ${ownerUserId}::uuid
        AND status = 'pending'
      ORDER BY created_at DESC, id
      LIMIT ${Math.max(0, Math.min(100, Math.trunc(limit)))}
    `.execute(scopedDb.db);
    return result.rows.map(mapCandidate);
  }

  async #mark(
    scopedDb: DataContextDb,
    ownerUserId: string,
    id: string,
    status: "promoted" | "rejected",
    reason: string
  ): Promise<boolean> {
    assertDataContextDb(scopedDb);
    const result = await sql<{ id: string }>`
      UPDATE app.memory_candidates
      SET status = ${status},
          promotion_reason = ${reason},
          resolved_at = now(),
          updated_at = now()
      WHERE owner_user_id = ${ownerUserId}::uuid
        AND id = ${id}::uuid
      RETURNING id
    `.execute(scopedDb.db);
    return result.rows.length > 0;
  }
}

export function createMemoryCandidateSignature(input: MemoryCandidateSignatureInput): string {
  const tuple = [
    input.kind,
    input.action,
    input.fact?.subject ?? input.entity?.name ?? "",
    input.fact?.predicate ?? "",
    input.fact?.objectName ?? input.fact?.objectText ?? "",
    input.alias?.alias ?? "",
    input.alias?.targetName ?? ""
  ]
    .map(normalizeSignaturePart)
    .join("|");
  return createHash("sha256").update(tuple).digest("hex");
}

function normalizeSignaturePart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
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
