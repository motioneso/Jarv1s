import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TaskApiStatus } from "@jarv1s/shared";
import { ArrowLeft, LoaderCircle, MessageSquarePlus, Save } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import { addTaskActivity, getTask, updateTask } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { fromDateInputValue, statusLabels, toDateInputValue } from "./task-format";

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
  const taskQuery = useQuery({
    enabled: Boolean(taskId),
    queryKey: queryKeys.tasks.detail(taskId ?? ""),
    queryFn: () => getTask(taskId ?? "")
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
        priority: priority ? Number(priority) : null
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
  const activityMutation = useMutation({
    mutationFn: () => {
      if (!taskId) {
        throw new Error("Task id is missing");
      }

      return addTaskActivity(taskId, { activityType: "comment", body: activityBody || null });
    },
    onSuccess: () => {
      setActivityBody("");
      setActivitySaved(true);
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
              <input
                max={32767}
                min={-32768}
                onChange={(event) => setPriority(event.target.value)}
                type="number"
                value={priority}
              />
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

        <section className="panel" aria-labelledby="activity-title">
          <div className="panel-heading">
            <MessageSquarePlus size={20} aria-hidden="true" />
            <h2 id="activity-title">Activity</h2>
          </div>

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
