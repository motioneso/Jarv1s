import { assertDataContextDb } from "@jarv1s/db";
import type { ToolExecute, ToolResult } from "@jarv1s/module-sdk";

import { TaskDriftRepository } from "./drift.js";
import { TaskListsRepository } from "./lists.js";
import { TasksRepository } from "./repository.js";
import {
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

  const { listId, tagId, status, priority, dueBefore, dueAfter, quadrant } = input as {
    listId?: string;
    tagId?: string;
    status?: string;
    priority?: number;
    dueBefore?: string;
    dueAfter?: string;
    quadrant?: string;
  };

  const tasks = await repository.listFiltered(scopedDb, {
    listId,
    tagId,
    status: status === "todo" || status === "done" || status === "archived" ? status : undefined,
    priority,
    dueBefore: dueBefore ? new Date(dueBefore) : undefined,
    dueAfter: dueAfter ? new Date(dueAfter) : undefined,
    quadrant:
      quadrant === "do" ||
      quadrant === "schedule" ||
      quadrant === "delegate" ||
      quadrant === "eliminate"
        ? quadrant
        : undefined
  });

  const tagMap = await repository.getTagsForTasks(
    scopedDb,
    tasks.map((t) => t.id)
  );
  return {
    data: { items: tasks.map((task) => serializeTask(task, tagMap.get(task.id) ?? [])) },
    columnOrder: ["id", "title", "status", "dueAt", "priority"]
  };
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

  const [tags, subtaskTagMap] = await Promise.all([
    repository.getTagsForTask(scopedDb, taskId),
    repository.getTagsForTasks(
      scopedDb,
      subtasks.map((s) => s.id)
    )
  ]);

  return {
    data: {
      task: serializeTask(task, tags),
      subtasks: subtasks.map((s) => serializeTask(s, subtaskTagMap.get(s.id) ?? [])),
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
  const tagMap = await repository.getTagsForTasks(
    scopedDb,
    tasks.map((t) => t.id)
  );
  return {
    data: { items: tasks.map((task) => serializeTask(task, tagMap.get(task.id) ?? [])) },
    columnOrder: ["id", "title", "status", "dueAt", "priority"]
  };
};

export const taskAtRiskExecute: ToolExecute = async (
  scopedDb,
  _input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const tasks = await drift.getAtRisk(scopedDb);
  const tagMap = await repository.getTagsForTasks(
    scopedDb,
    tasks.map((t) => t.id)
  );
  return {
    data: { items: tasks.map((task) => serializeTask(task, tagMap.get(task.id) ?? [])) },
    columnOrder: ["id", "title", "status", "dueAt", "priority"]
  };
};

export const taskOverdueExecute: ToolExecute = async (
  scopedDb,
  _input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const tasks = await drift.getOverdue(scopedDb);
  const tagMap = await repository.getTagsForTasks(
    scopedDb,
    tasks.map((t) => t.id)
  );
  return {
    data: { items: tasks.map((task) => serializeTask(task, tagMap.get(task.id) ?? [])) },
    columnOrder: ["id", "title", "status", "dueAt", "priority"]
  };
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

export const taskUpdateStatusExecute: ToolExecute = async (
  scopedDb,
  input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);

  const { taskId, status } = input as { taskId: string; status: unknown };
  if (status !== "todo" && status !== "done" && status !== "archived") {
    return { data: { error: "Invalid status" } };
  }

  const task = await repository.updateStatus(scopedDb, taskId, status);
  if (!task) {
    return { data: { error: "Task not found" } };
  }

  const tags = await repository.getTagsForTask(scopedDb, task.id);
  return { data: { task: serializeTask(task, tags) } };
};
