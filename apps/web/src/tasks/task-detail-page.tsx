import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TaskActivityDto, TaskApiStatus } from "@jarv1s/shared";
import { PRIORITY_LEVELS } from "@jarv1s/shared";
import { ArrowLeft, ListTree, LoaderCircle, MessageSquarePlus, Save } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import {
  addTaskActivity,
  breakdownTask,
  getTask,
  listSubtasks,
  listTaskActivity,
  listTaskLists,
  updateTask
} from "../api/client";
import { queryKeys } from "../api/query-keys";
import { effortLabel, fromDateInputValue, statusLabels, toDateInputValue } from "./task-format";

export function TaskDetailPage() {
  const { taskId } = useParams<{ readonly taskId: string }>();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskApiStatus>("todo");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState("");
  const [activityBody, setActivityBody] = useState("");
  const [activitySaved, setActivitySaved] = useState(false);
  const [doAt, setDoAt] = useState("");
  const [effort, setEffort] = useState("");
  const [listId, setListId] = useState("");
  const [steps, setSteps] = useState("");
  const taskQuery = useQuery({
    enabled: Boolean(taskId),
    queryKey: queryKeys.tasks.detail(taskId ?? ""),
    queryFn: () => getTask(taskId ?? "")
  });
  const activityQuery = useQuery({
    enabled: Boolean(taskId),
    queryKey: queryKeys.tasks.activity(taskId ?? ""),
    queryFn: () => listTaskActivity(taskId ?? "")
  });
  const listsQuery = useQuery({ queryKey: queryKeys.tasks.lists, queryFn: listTaskLists });
  const subtasksQuery = useQuery({
    enabled: Boolean(taskId),
    queryKey: queryKeys.tasks.subtasks(taskId ?? ""),
    queryFn: () => listSubtasks(taskId ?? "")
  });
  const saveMutation = useMutation({
    mutationFn: () => {
      if (!taskId) {
        throw new Error("Task id is missing");
      }

      return updateTask(taskId, {
        title,
        description: description || null,
        status,
        dueAt: fromDateInputValue(dueAt),
        doAt: fromDateInputValue(doAt),
        priority: priority ? Number(priority) : null,
        effort: (effort || null) as "quick" | "medium" | "large" | null,
        listId: listId || undefined
      });
    },
    onSuccess: async () => {
      if (!taskId) {
        return;
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.list }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.detail(taskId) })
      ]);
    }
  });
  const breakdownMutation = useMutation({
    mutationFn: () => {
      if (!taskId) throw new Error("Task id is missing");
      const items = steps
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      return breakdownTask(taskId, { steps: items });
    },
    onSuccess: async () => {
      setSteps("");
      if (taskId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.subtasks(taskId) });
      }
    }
  });
  const activityMutation = useMutation({
    mutationFn: () => {
      if (!taskId) {
        throw new Error("Task id is missing");
      }

      return addTaskActivity(taskId, { activityType: "comment", body: activityBody || null });
    },
    onSuccess: async () => {
      setActivityBody("");
      setActivitySaved(true);
      if (taskId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.activity(taskId) });
      }
    }
  });

  useEffect(() => {
    const task = taskQuery.data?.task;

    if (!task) {
      return;
    }

    setTitle(task.title);
    setDescription(task.description ?? "");
    setStatus(task.status);
    setDueAt(toDateInputValue(task.dueAt));
    setPriority(task.priority === null ? "" : String(task.priority));
    setDoAt(toDateInputValue(task.doAt));
    setEffort(task.effort ?? "");
    setListId(task.listId);
  }, [taskQuery.data?.task]);

  const handleSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    saveMutation.mutate();
  };

  const handleActivitySubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setActivitySaved(false);
    activityMutation.mutate();
  };

  if (taskQuery.isLoading) {
    return <DetailState title="Loading task" loading />;
  }

  if (taskQuery.error) {
    return <DetailState title={taskQuery.error.message} />;
  }

  if (!taskQuery.data?.task) {
    return <DetailState title="Task not found" />;
  }

  return (
    <section className="page-stack" aria-labelledby="task-detail-title">
      <div className="page-heading">
        <div>
          <Link className="back-link" to="/tasks">
            <ArrowLeft size={17} aria-hidden="true" />
            Tasks
          </Link>
          <h1 id="task-detail-title">Edit Task</h1>
        </div>
      </div>

      <div className="detail-grid">
        <section className="panel" aria-labelledby="task-fields-title">
          <div className="panel-heading">
            <Save size={20} aria-hidden="true" />
            <h2 id="task-fields-title">Fields</h2>
          </div>

          <form className="task-detail-form" onSubmit={handleSave}>
            <label className="span-2">
              Title
              <input
                onChange={(event) => setTitle(event.target.value)}
                required
                type="text"
                value={title}
              />
            </label>

            <label className="span-2">
              Description
              <textarea
                onChange={(event) => setDescription(event.target.value)}
                rows={5}
                value={description}
              />
            </label>

            <label>
              Status
              <select
                onChange={(event) => setStatus(event.target.value as TaskApiStatus)}
                value={status}
              >
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Due
              <input onChange={(event) => setDueAt(event.target.value)} type="date" value={dueAt} />
            </label>

            <label>
              Priority
              <select onChange={(event) => setPriority(event.target.value)} value={priority}>
                <option value="">None</option>
                {PRIORITY_LEVELS.map((level) => (
                  <option key={level.value} value={level.value}>
                    {level.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              List
              <select onChange={(event) => setListId(event.target.value)} value={listId}>
                {(listsQuery.data?.lists ?? []).map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Do on
              <input onChange={(event) => setDoAt(event.target.value)} type="date" value={doAt} />
            </label>

            <label>
              Effort
              <select onChange={(event) => setEffort(event.target.value)} value={effort}>
                <option value="">—</option>
                <option value="quick">Quick</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </select>
            </label>

            {saveMutation.error ? (
              <p className="form-error span-2">{saveMutation.error.message}</p>
            ) : null}

            <button
              className="primary-button span-2"
              disabled={saveMutation.isPending}
              type="submit"
            >
              {saveMutation.isPending ? (
                <LoaderCircle className="spin" size={18} aria-hidden="true" />
              ) : (
                <Save size={18} aria-hidden="true" />
              )}
              Save task
            </button>
          </form>
        </section>

        <section className="panel" aria-labelledby="subtasks-title">
          <div className="panel-heading">
            <ListTree size={20} aria-hidden="true" />
            <h2 id="subtasks-title">Subtasks</h2>
          </div>
          {subtasksQuery.data && subtasksQuery.data.tasks.length > 0 ? (
            <ul className="subtask-list">
              {subtasksQuery.data.tasks.map((sub) => (
                <li className={`subtask-item ${sub.status === "done" ? "done" : ""}`} key={sub.id}>
                  <Link to={`/tasks/${sub.id}`}>{sub.title}</Link>
                  {effortLabel(sub.effort) ? (
                    <span className="task-effort">{effortLabel(sub.effort)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-hint">No subtasks yet.</p>
          )}
          {taskQuery.data?.task.parentTaskId === null ? (
            <form
              className="subtask-form"
              onSubmit={(event) => {
                event.preventDefault();
                breakdownMutation.mutate();
              }}
            >
              <label>
                Break into steps (one per line)
                <textarea
                  onChange={(event) => setSteps(event.target.value)}
                  placeholder={"unload dishwasher\nwipe counters"}
                  rows={3}
                  value={steps}
                />
              </label>
              {breakdownMutation.error ? (
                <p className="form-error">{breakdownMutation.error.message}</p>
              ) : null}
              <button
                className="secondary-button"
                disabled={breakdownMutation.isPending}
                type="submit"
              >
                {breakdownMutation.isPending ? (
                  <LoaderCircle className="spin" size={18} aria-hidden="true" />
                ) : (
                  <ListTree size={18} aria-hidden="true" />
                )}
                Add steps
              </button>
            </form>
          ) : null}
        </section>

        <section className="panel" aria-labelledby="activity-title">
          <div className="panel-heading">
            <MessageSquarePlus size={20} aria-hidden="true" />
            <h2 id="activity-title">Activity</h2>
          </div>

          {activityQuery.data && activityQuery.data.activity.length > 0 ? (
            <ul className="activity-list">
              {activityQuery.data.activity.map((entry) => (
                <ActivityEntry key={entry.id} entry={entry} />
              ))}
            </ul>
          ) : null}

          <form className="activity-form" onSubmit={handleActivitySubmit}>
            <label>
              Comment
              <textarea
                onChange={(event) => setActivityBody(event.target.value)}
                rows={6}
                value={activityBody}
              />
            </label>
            {activitySaved ? <p className="status-good">Activity saved</p> : null}
            {activityMutation.error ? (
              <p className="form-error">{activityMutation.error.message}</p>
            ) : null}
            <button
              className="secondary-button"
              disabled={activityMutation.isPending}
              type="submit"
            >
              {activityMutation.isPending ? (
                <LoaderCircle className="spin" size={18} aria-hidden="true" />
              ) : (
                <MessageSquarePlus size={18} aria-hidden="true" />
              )}
              Add activity
            </button>
          </form>
        </section>
      </div>
    </section>
  );
}

function ActivityEntry(props: { readonly entry: TaskActivityDto }) {
  const date = props.entry.createdAt ? new Date(props.entry.createdAt).toLocaleString() : "";

  return (
    <li className="activity-entry">
      <div className="activity-meta">
        <span className="activity-type">{props.entry.activityType}</span>
        <span className="activity-date">{date}</span>
      </div>
      {props.entry.body ? <p className="activity-body">{props.entry.body}</p> : null}
    </li>
  );
}

function DetailState(props: { readonly loading?: boolean; readonly title: string }) {
  return (
    <section className="page-stack">
      <Link className="back-link" to="/tasks">
        <ArrowLeft size={17} aria-hidden="true" />
        Tasks
      </Link>
      <div className="empty-state">
        {props.loading ? (
          <LoaderCircle className="spin" size={22} aria-hidden="true" />
        ) : (
          <Save size={22} aria-hidden="true" />
        )}
        <p>{props.title}</p>
      </div>
    </section>
  );
}
