import { sql } from "kysely";

import { assertDataContextDb, type DataContextDb, type EmailActionSuppression } from "@jarv1s/db";

export interface EmailActionSuppressionInput {
  readonly subjectSignature: string;
  readonly dismissalCount: number;
  readonly lastDeadlineEvidenceKey?: string | null;
  readonly lastContextMessageKey?: string | null;
}

export class EmailActionSuppressionRepository {
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
}

export { EmailActionSuppressionRepository as ActionSuppressionRepository };
