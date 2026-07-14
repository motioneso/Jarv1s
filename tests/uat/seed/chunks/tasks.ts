import type { DataContextRunner } from "@jarv1s/db";
import { TasksRepository } from "@jarv1s/tasks";
import { UAT_SEED_BASE_TIMESTAMP, daysBefore, daysAfter } from "../timestamps.js";

/**
 * #1025 "lived-in account": a spread across statuses/due dates so the tasks
 * list/board views have something real to render, not one placeholder row.
 * All dueAt values derive from UAT_SEED_BASE_TIMESTAMP — never `new Date()`.
 */
const UAT_TASKS: ReadonlyArray<{
  title: string;
  status?: "todo" | "done";
  dueAt?: Date;
  priority?: number;
}> = [
  { title: "Draft Q1 planning doc", dueAt: daysAfter(UAT_SEED_BASE_TIMESTAMP, 3), priority: 1 },
  { title: "Review PR backlog", dueAt: daysAfter(UAT_SEED_BASE_TIMESTAMP, 1), priority: 2 },
  { title: "Renew domain registration", dueAt: daysAfter(UAT_SEED_BASE_TIMESTAMP, 10) },
  { title: "Book dentist appointment", dueAt: daysAfter(UAT_SEED_BASE_TIMESTAMP, 14) },
  { title: "Fix leaking faucet", status: "done", dueAt: daysBefore(UAT_SEED_BASE_TIMESTAMP, 2) },
  { title: "Send thank-you note", status: "done", dueAt: daysBefore(UAT_SEED_BASE_TIMESTAMP, 5) },
  { title: "Prepare quarterly taxes", dueAt: daysAfter(UAT_SEED_BASE_TIMESTAMP, 30) },
  { title: "Plan weekend trip", priority: 3 },
  { title: "Update resume", dueAt: daysAfter(UAT_SEED_BASE_TIMESTAMP, 21) },
  { title: "Organize garage", status: "done", dueAt: daysBefore(UAT_SEED_BASE_TIMESTAMP, 10) },
  { title: "Read design doc from teammate", dueAt: daysAfter(UAT_SEED_BASE_TIMESTAMP, 2) },
  { title: "Schedule car maintenance", dueAt: daysAfter(UAT_SEED_BASE_TIMESTAMP, 7) }
];

export async function seedTasksChunk(
  runner: DataContextRunner,
  actorUserId: string
): Promise<void> {
  const repo = new TasksRepository();
  await runner.withDataContext({ actorUserId }, async (scopedDb) => {
    for (const task of UAT_TASKS) {
      await repo.create(scopedDb, {
        title: task.title,
        status: task.status,
        dueAt: task.dueAt,
        priority: task.priority ?? null
      });
    }
  });
}
