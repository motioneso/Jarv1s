import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TaskApiStatus, TaskDto } from "@jarv1s/shared";
import {
  Archive,
  CheckCircle2,
  Circle,
  ClipboardList,
  LoaderCircle,
  Plus,
  Search
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Link } from "react-router";

import { createTask, listTasks, updateTask } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { formatDate, fromDateInputValue, sortTasks, statusLabels } from "./task-format";

const taskStatusFilters = ["all", "todo", "in_progress", "done", "archived"] as const;

type TaskStatusFilter = (typeof taskStatusFilters)[number];

export function TasksPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<TaskStatusFilter>("all");
  const [search, setSearch] = useState("");
  const tasksQuery = useQuery({
    queryKey: queryKeys.tasks.list,
    queryFn: () => listTasks()
  });
  const updateMutation = useMutation({
    mutationFn: (input: { readonly taskId: string; readonly status: TaskApiStatus }) =>
      updateTask(input.taskId, { status: input.status }),
    onSuccess: async (_, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.list }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.detail(input.taskId) })
      ]);
    }
  });
  const tasks = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return sortTasks(tasksQuery.data?.tasks ?? []).filter((task) => {
      const matchesStatus = statusFilter === "all" || task.status === statusFilter;
      const matchesSearch =
        !normalizedSearch ||
        task.title.toLowerCase().includes(normalizedSearch) ||
        (task.description?.toLowerCase().includes(normalizedSearch) ?? false);

      return matchesStatus && matchesSearch;
    });
  }, [search, statusFilter, tasksQuery.data?.tasks]);
  const counts = useMemo(() => readStatusCounts(tasksQuery.data?.tasks ?? []), [tasksQuery.data]);

  return (
    <section className="page-stack" aria-labelledby="tasks-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Tasks</p>
          <h1 id="tasks-title">Task Board</h1>
        </div>
      </div>

      <CreateTaskPanel />

      <section className="task-toolbar" aria-label="Task filters">
        <div className="segmented-control wide" aria-label="Status filter">
          {taskStatusFilters.map((status) => (
            <button
              className={statusFilter === status ? "active" : ""}
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
            >
              {status === "all" ? "All" : statusLabels[status]}
              <span>{status === "all" ? counts.all : counts[status]}</span>
            </button>
          ))}
        </div>

        <label className="search-box">
          <Search size={18} aria-hidden="true" />
          <input
            aria-label="Search tasks"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search tasks"
            type="search"
            value={search}
          />
        </label>
      </section>

      <section className="task-list" aria-live="polite">
        {tasksQuery.isLoading ? (
          <EmptyState icon="loading" title="Loading tasks" />
        ) : tasksQuery.error ? (
          <EmptyState title={tasksQuery.error.message} />
        ) : tasks.length === 0 ? (
          <EmptyState title="No tasks" />
        ) : (
          tasks.map((task) => (
            <TaskRow
              isUpdating={updateMutation.isPending}
              key={task.id}
              onArchive={() => updateMutation.mutate({ taskId: task.id, status: "archived" })}
              onStatusChange={(status) => updateMutation.mutate({ taskId: task.id, status })}
              task={task}
            />
          ))
        )}
      </section>
    </section>
  );
}

function CreateTaskPanel() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const createMutation = useMutation({
    mutationFn: () =>
      createTask({
        title,
        description: description || null,
        priority: priority ? Number(priority) : null,
        dueAt: fromDateInputValue(dueAt)
      }),
    onSuccess: async () => {
      setTitle("");
      setDescription("");
      setDueAt("");
      setPriority("");
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.list });
    },
    onError: (error) => setFormError(error.message)
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    createMutation.mutate();
  };

  return (
    <section className="panel" aria-labelledby="new-task-title">
      <div className="panel-heading">
        <ClipboardList size={20} aria-hidden="true" />
        <h2 id="new-task-title">New Task</h2>
      </div>

      <form className="task-create-form" onSubmit={handleSubmit}>
        <label className="span-2">
          Title
          <input
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Task title"
            required
            type="text"
            value={title}
          />
        </label>

        <label className="span-2">
          Description
          <textarea
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Notes"
            rows={3}
            value={description}
          />
        </label>

        <label>
          Due
          <input onChange={(event) => setDueAt(event.target.value)} type="date" value={dueAt} />
        </label>

        <label>
          Priority
          <input
            max={32767}
            min={-32768}
            onChange={(event) => setPriority(event.target.value)}
            placeholder="0"
            type="number"
            value={priority}
          />
        </label>

        {formError ? <p className="form-error span-2">{formError}</p> : null}

        <button className="primary-button span-2" disabled={createMutation.isPending} type="submit">
          {createMutation.isPending ? (
            <LoaderCircle className="spin" size={18} aria-hidden="true" />
          ) : (
            <Plus size={18} aria-hidden="true" />
          )}
          Add task
        </button>
      </form>
    </section>
  );
}

function TaskRow(props: {
  readonly isUpdating: boolean;
  readonly onArchive: () => void;
  readonly onStatusChange: (status: TaskApiStatus) => void;
  readonly task: TaskDto;
}) {
  const done = props.task.status === "done";

  return (
    <article className={`task-row ${done ? "done" : ""}`}>
      <div className="task-status-icon" aria-hidden="true">
        {done ? <CheckCircle2 size={22} /> : <Circle size={22} />}
      </div>
      <div className="task-row-main">
        <Link className="task-title-link" to={`/tasks/${props.task.id}`}>
          {props.task.title}
        </Link>
        {props.task.description ? <p>{props.task.description}</p> : null}
        <div className="task-meta">
          <span>{statusLabels[props.task.status]}</span>
          <span>{formatDate(props.task.dueAt)}</span>
        </div>
      </div>
      <div className="task-row-actions">
        <select
          aria-label={`Status for ${props.task.title}`}
          disabled={props.isUpdating}
          onChange={(event) => props.onStatusChange(event.target.value as TaskApiStatus)}
          value={props.task.status}
        >
          <option value="todo">Todo</option>
          <option value="in_progress">Doing</option>
          <option value="done">Done</option>
          <option value="archived">Archived</option>
        </select>
        <button
          aria-label={`Archive ${props.task.title}`}
          className="icon-button"
          disabled={props.isUpdating || props.task.status === "archived"}
          title="Archive"
          type="button"
          onClick={props.onArchive}
        >
          <Archive size={18} aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

function EmptyState(props: { readonly icon?: "loading"; readonly title: string }) {
  return (
    <div className="empty-state">
      {props.icon === "loading" ? (
        <LoaderCircle className="spin" size={22} aria-hidden="true" />
      ) : (
        <ClipboardList size={22} aria-hidden="true" />
      )}
      <p>{props.title}</p>
    </div>
  );
}

function readStatusCounts(tasks: readonly TaskDto[]) {
  const counts: Record<TaskStatusFilter, number> = {
    all: tasks.length,
    todo: 0,
    in_progress: 0,
    done: 0,
    archived: 0
  };

  for (const task of tasks) {
    counts[task.status] += 1;
  }

  return counts;
}
