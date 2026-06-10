import { assertDataContextDb } from "@jarv1s/db";
import type { ToolExecute, ToolResult } from "@jarv1s/module-sdk";

import { TaskDriftRepository } from "./drift.js";
import { TaskListsRepository } from "./lists.js";
import { TasksRepository } from "./repository.js";
import {
  filterByQuadrant,
  serializeTask,
  serializeTaskActivity,
  serializeTaskList,
  serializeTaskTag
} from "./serialize.js";

const repository = new TasksRepository();
const drift = new TaskDriftRepository();
const lists = new TaskListsRepository();

export const taskListExecute: ToolExecute = async (scopedDb, input, _ctx): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);

  let tasks = await repository.listVisible(scopedDb);

  const { listId, tagId, status, priority, dueBefore, dueAfter, quadrant } = input as {
    listId?: string;
    tagId?: string;
    status?: string;
    priority?: number;
    dueBefore?: string;
    dueAfter?: string;
    quadrant?: string;
  };

  if (listId) tasks = tasks.filter((t) => t.list_id === listId);
  if (status) tasks = tasks.filter((t) => t.status === status);
  if (priority !== undefined) tasks = tasks.filter((t) => t.priority === priority);
  if (dueBefore) {
    const before = new Date(dueBefore);
    tasks = tasks.filter((t) => t.due_at !== null && new Date(t.due_at as Date | string) < before);
  }
  if (dueAfter) {
    const after = new Date(dueAfter);
    tasks = tasks.filter((t) => t.due_at !== null && new Date(t.due_at as Date | string) > after);
  }
  if (
    quadrant === "do" ||
    quadrant === "schedule" ||
    quadrant === "delegate" ||
    quadrant === "eliminate"
  ) {
    tasks = filterByQuadrant(tasks, quadrant);
  }
  if (tagId) {
    const tagged = await scopedDb.db
      .selectFrom("app.task_tag_assignments")
      .select("task_id")
      .where("tag_id", "=", tagId)
      .execute();
    const taggedSet = new Set(tagged.map((r) => r.task_id));
    tasks = tasks.filter((t) => taggedSet.has(t.id));
  }

  return { data: { items: tasks.map(serializeTask) }, columnOrder: ["id", "title", "status", "dueAt", "priority"] };
};

export const taskGetExecute: ToolExecute = async (scopedDb, input, _ctx): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);

  const { taskId } = input as { taskId: string };

  const [task, subtasks, activity] = await Promise.all([
    repository.getById(scopedDb, taskId),
    repository.listByParentId(scopedDb, taskId),
    repository.listActivity(scopedDb, taskId)
  ]);

  if (!task) {
    return { data: { error: "Task not found" } };
  }

  return {
    data: {
      task: serializeTask(task),
      subtasks: subtasks.map(serializeTask),
      activity: activity.slice(-10).map(serializeTaskActivity)
    }
  };
};

export const taskFocusExecute: ToolExecute = async (
  scopedDb,
  _input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const tasks = await drift.getFocus(scopedDb);
  return { data: { items: tasks.map(serializeTask) }, columnOrder: ["id", "title", "status", "dueAt", "priority"] };
};

export const taskAtRiskExecute: ToolExecute = async (
  scopedDb,
  _input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const tasks = await drift.getAtRisk(scopedDb);
  return { data: { items: tasks.map(serializeTask) }, columnOrder: ["id", "title", "status", "dueAt", "priority"] };
};

export const taskOverdueExecute: ToolExecute = async (
  scopedDb,
  _input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const tasks = await drift.getOverdue(scopedDb);
  return { data: { items: tasks.map(serializeTask) }, columnOrder: ["id", "title", "status", "dueAt", "priority"] };
};

export const taskListListsExecute: ToolExecute = async (
  scopedDb,
  _input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const taskLists = await lists.list(scopedDb);
  return { data: { items: taskLists.map(serializeTaskList) } };
};

export const taskListTagsExecute: ToolExecute = async (
  scopedDb,
  input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const { listId } = input as { listId: string };
  const tags = await lists.listTags(scopedDb, listId);
  return { data: { items: tags.map(serializeTaskTag) } };
};

export const taskActivityExecute: ToolExecute = async (
  scopedDb,
  input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const { taskId } = input as { taskId: string };
  const activity = await repository.listActivity(scopedDb, taskId);
  return { data: { items: activity.map(serializeTaskActivity) } };
};
