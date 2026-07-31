import { sql } from "kysely";

import { assertDataContextDb, type DataContextDb, type EmailActionSuppression } from "@jarv1s/db";

export interface EmailActionSuppressionInput {
  readonly subjectSignature: string;
  readonly dismissalCount: number;
  readonly lastDeadlineEvidenceKey?: string | null;
  readonly lastContextMessageKey?: string | null;
}

export interface EmailActionSuppressionSnapshot {
  readonly subjectSignature: string;
  readonly dismissalCount: number;
  readonly lastDeadlineEvidenceKey: string | null;
  readonly lastContextMessageKey: string | null;
  readonly deadlineEvidenceKeys: readonly string[];
  readonly contextMessageKeys: readonly string[];
}

export function resetAcceptedSuppression(
  state: Pick<
    EmailActionSuppression,
    "dismissal_count" | "last_deadline_evidence_key" | "last_context_message_key"
  >
): Pick<
  EmailActionSuppression,
  "dismissal_count" | "last_deadline_evidence_key" | "last_context_message_key"
> {
  return {
    ...state,
    dismissal_count: 0,
    last_deadline_evidence_key: null,
    last_context_message_key: null
  };
}

export class EmailActionSuppressionRepository {
  async list(
    scopedDb: DataContextDb,
    subjectSignatures: readonly string[]
  ): Promise<EmailActionSuppressionSnapshot[]> {
    assertDataContextDb(scopedDb);
    if (subjectSignatures.length === 0) return [];

    const rows = await scopedDb.db
      .selectFrom("app.email_action_suppression")
      .selectAll()
      .where("subject_signature", "in", [...new Set(subjectSignatures)])
      .execute();
    const evidenceRows = await scopedDb.db
      .selectFrom("app.email_action_suppression_evidence")
      .select(["subject_signature", "evidence_kind", "evidence_key"])
      .where("subject_signature", "in", [...new Set(subjectSignatures)])
      .execute();
    const evidenceBySubject = new Map<string, { deadline: string[]; context: string[] }>();
    for (const evidence of evidenceRows) {
      const values = evidenceBySubject.get(evidence.subject_signature) ?? {
        deadline: [],
        context: []
      };
      values[evidence.evidence_kind].push(evidence.evidence_key);
      evidenceBySubject.set(evidence.subject_signature, values);
    }
    return rows.map((row) => ({
      subjectSignature: row.subject_signature,
      dismissalCount: row.dismissal_count,
      lastDeadlineEvidenceKey: row.last_deadline_evidence_key,
      lastContextMessageKey: row.last_context_message_key,
      deadlineEvidenceKeys: [
        ...(row.last_deadline_evidence_key ? [row.last_deadline_evidence_key] : []),
        ...(evidenceBySubject.get(row.subject_signature)?.deadline ?? [])
      ].filter((key, index, keys) => keys.indexOf(key) === index),
      contextMessageKeys: [
        ...(row.last_context_message_key ? [row.last_context_message_key] : []),
        ...(evidenceBySubject.get(row.subject_signature)?.context ?? [])
      ].filter((key, index, keys) => keys.indexOf(key) === index)
    }));
  }

  async get(
    scopedDb: DataContextDb,
    subjectSignature: string
  ): Promise<EmailActionSuppression | undefined> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.email_action_suppression")
      .selectAll()
      .where("subject_signature", "=", subjectSignature)
      .executeTakeFirst();
  }

  async upsert(
    scopedDb: DataContextDb,
    input: EmailActionSuppressionInput
  ): Promise<EmailActionSuppression> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .insertInto("app.email_action_suppression")
      .values({
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        subject_signature: input.subjectSignature,
        dismissal_count: input.dismissalCount,
        last_deadline_evidence_key: input.lastDeadlineEvidenceKey ?? null,
        last_context_message_key: input.lastContextMessageKey ?? null,
        updated_at: new Date()
      })
      .onConflict((oc) =>
        oc.columns(["owner_user_id", "subject_signature"]).doUpdateSet({
          dismissal_count: input.dismissalCount,
          last_deadline_evidence_key: input.lastDeadlineEvidenceKey ?? null,
          last_context_message_key: input.lastContextMessageKey ?? null,
          updated_at: new Date()
        })
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async incrementDismissal(
    scopedDb: DataContextDb,
    subjectSignature: string
  ): Promise<EmailActionSuppression> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .insertInto("app.email_action_suppression")
      .values({
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        subject_signature: subjectSignature,
        dismissal_count: 1,
        last_deadline_evidence_key: null,
        last_context_message_key: null,
        updated_at: new Date()
      })
      .onConflict((oc) =>
        oc.columns(["owner_user_id", "subject_signature"]).doUpdateSet({
          dismissal_count: sql<number>`email_action_suppression.dismissal_count + 1`,
          updated_at: new Date()
        })
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /** Accept reset is deliberately UPDATE-only: accepting an unseen subject never inserts state. */
  async resetAccepted(scopedDb: DataContextDb, subjectSignature: string): Promise<boolean> {
    assertDataContextDb(scopedDb);
    const result = await scopedDb.db
      .updateTable("app.email_action_suppression")
      .set({
        dismissal_count: 0,
        last_deadline_evidence_key: null,
        last_context_message_key: null,
        updated_at: new Date()
      })
      .where("subject_signature", "=", subjectSignature)
      .executeTakeFirst();
    if ((result.numUpdatedRows ?? 0n) > 0n) {
      await scopedDb.db
        .deleteFrom("app.email_action_suppression_evidence")
        .where("subject_signature", "=", subjectSignature)
        .execute();
    }
    return (result.numUpdatedRows ?? 0n) > 0n;
  }

  async recordContextEvidence(
    scopedDb: DataContextDb,
    subjectSignature: string,
    evidenceKey: string
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    await scopedDb.db
      .insertInto("app.email_action_suppression_evidence")
      .values({
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        subject_signature: subjectSignature,
        evidence_kind: "context",
        evidence_key: evidenceKey,
        created_at: new Date()
      })
      .onConflict((oc) =>
        oc
          .columns(["owner_user_id", "subject_signature", "evidence_kind", "evidence_key"])
          .doNothing()
      )
      .execute();
    await scopedDb.db
      .updateTable("app.email_action_suppression")
      .set({ last_context_message_key: evidenceKey, updated_at: new Date() })
      .where("subject_signature", "=", subjectSignature)
      .execute();
  }

  async recordDeadlineEvidence(
    scopedDb: DataContextDb,
    subjectSignature: string,
    evidenceKey: string
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    await scopedDb.db
      .insertInto("app.email_action_suppression_evidence")
      .values({
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        subject_signature: subjectSignature,
        evidence_kind: "deadline",
        evidence_key: evidenceKey,
        created_at: new Date()
      })
      .onConflict((oc) =>
        oc
          .columns(["owner_user_id", "subject_signature", "evidence_kind", "evidence_key"])
          .doNothing()
      )
      .execute();
    await scopedDb.db
      .updateTable("app.email_action_suppression")
      .set({ last_deadline_evidence_key: evidenceKey, updated_at: new Date() })
      .where("subject_signature", "=", subjectSignature)
      .execute();
  }
}

export { EmailActionSuppressionRepository as ActionSuppressionRepository };
