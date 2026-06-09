import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, LoaderCircle, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";

import { PRIORITY_LEVELS } from "@jarv1s/shared";

import { createTask, listTaskLists } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { fromDateInputValue } from "./task-format";

type Repeats = "" | "daily" | "weekly" | "monthly";

export function TaskCapture(props: { readonly defaultListId?: string }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [listId, setListId] = useState("");
  const [priority, setPriority] = useState("");
  const [doAt, setDoAt] = useState("");
  const [effort, setEffort] = useState("");
  const [repeats, setRepeats] = useState<Repeats>("");
  const [formError, setFormError] = useState<string | null>(null);

  const listsQuery = useQuery({ queryKey: queryKeys.tasks.lists, queryFn: listTaskLists });

  const createMutation = useMutation({
    mutationFn: () =>
      createTask({
        title: title.trim(),
        listId: (listId || props.defaultListId) || undefined,
        priority: priority ? Number(priority) : null,
        doAt: fromDateInputValue(doAt),
        effort: (effort || null) as "quick" | "medium" | "large" | null,
        recurrence: repeats ? { freq: repeats, interval: 1 } : null
      }),
    onSuccess: async () => {
      setTitle("");
      setPriority("");
      setDoAt("");
      setEffort("");
      setRepeats("");
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.list });
    },
    onError: (error) => setFormError(error.message)
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) return;
    setFormError(null);
    createMutation.mutate();
  };

  return (
    <form className="task-capture" onSubmit={handleSubmit} aria-label="Capture a task">
      <div className="task-capture-row">
        <input
          aria-label="Task title"
          autoFocus
          className="task-capture-input"
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add a task…"
          type="text"
          value={title}
        />
        <button className="primary-button" disabled={createMutation.isPending || !title.trim()} type="submit">
          {createMutation.isPending ? (
            <LoaderCircle className="spin" size={18} aria-hidden="true" />
          ) : (
            <Plus size={18} aria-hidden="true" />
          )}
          Add
        </button>
      </div>

      <button
        aria-expanded={showMore}
        className="task-capture-more"
        onClick={() => setShowMore((value) => !value)}
        type="button"
      >
        <ChevronDown size={15} aria-hidden="true" /> More options
      </button>

      {showMore ? (
        <div className="task-capture-fields">
          <label>
            List
            <select onChange={(event) => setListId(event.target.value)} value={listId}>
              <option value="">{props.defaultListId ? "Default" : "Personal"}</option>
              {(listsQuery.data?.lists ?? []).map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
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
          <label>
            Repeats
            <select onChange={(event) => setRepeats(event.target.value as Repeats)} value={repeats}>
              <option value="">Never</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
        </div>
      ) : null}

      {formError ? <p className="form-error">{formError}</p> : null}
    </form>
  );
}
