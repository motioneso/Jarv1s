import type { AccessContext, DataContextDb, DataContextRunner, Task, TaskStatus } from "@jarv1s/db";

/**
 * Structural port for recording accept/reject feedback when a user resolves an
 * email-suggested task. Implemented by the composition root over the connectors
 * module's triage-feedback store — tasks never imports connectors (module isolation).
 */
export interface EmailTriageFeedbackPort {
  record(
    scopedDb: DataContextDb,
    input: {
      readonly taskSourceRef: string | null;
      readonly verdict: "accepted" | "rejected";
      readonly title: string;
    }
  ): Promise<void>;
}

/**
 * A status change on an email-suggested task IS the user's triage verdict:
 * todo/done = accepted, archived = rejected. Anything else records nothing.
 */
export function resolveTriageVerdict(
  prior: Task,
  nextStatus: TaskStatus | undefined
): "accepted" | "rejected" | null {
  if (prior.source !== "email" || prior.status !== "suggested") {
    return null;
  }
  if (nextStatus === "todo" || nextStatus === "done") {
    return "accepted";
  }
  if (nextStatus === "archived") {
    return "rejected";
  }
  return null;
}

interface TriageLogger {
  warn(obj: unknown, msg: string): void;
}

/**
 * Feedback recording runs OUTSIDE the update transaction and is failure-isolated
 * (mirrors reconcileRecurrenceSchedule): learning must never break the user's action.
 */
export async function recordTriageFeedbackIfNeeded(
  dependencies: {
    readonly dataContext: DataContextRunner;
    readonly emailTriageFeedback?: EmailTriageFeedbackPort;
  },
  accessContext: AccessContext,
  logger: TriageLogger,
  params: {
    readonly taskId: string;
    readonly taskSourceRef: string | null;
    readonly title: string;
    readonly triageVerdict: "accepted" | "rejected" | null;
  }
): Promise<void> {
  if (!params.triageVerdict || !dependencies.emailTriageFeedback) {
    return;
  }
  const feedbackPort = dependencies.emailTriageFeedback;
  const verdict = params.triageVerdict;
  try {
    await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
      feedbackPort.record(scopedDb, {
        taskSourceRef: params.taskSourceRef,
        verdict,
        title: params.title
      })
    );
  } catch (feedbackError) {
    // Log without task title or email content — id + verdict only.
    logger.warn(
      { err: feedbackError, taskId: params.taskId, verdict },
      "email triage feedback recording failed"
    );
  }
}
