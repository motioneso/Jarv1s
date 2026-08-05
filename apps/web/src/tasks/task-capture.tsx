import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@jarv1s/ui";
import { LoaderCircle, Plus, SlidersHorizontal } from "lucide-react";
import { type FormEvent, useState } from "react";

import { createTask } from "../api/client";
import { queryKeys } from "../api/query-keys";

/** Pinned quick-add bar. "Add task" captures the title directly; "Details" opens the
    full Details modal (the prototype's tk-add behaviour). */
export function TaskCapture(props: {
  readonly defaultListId?: string;
  readonly onDetails: (name: string) => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => createTask({ title: title.trim(), listId: props.defaultListId || undefined }),
    onSuccess: async () => {
      setTitle("");
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
      <div className="tk-add">
        <span className="tk-add__plus">
          <Plus size={18} aria-hidden="true" />
        </span>
        <input
          aria-label="Task title"
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add a task — type and press Enter…"
          type="text"
          value={title}
        />
        <div className="tk-add__actions">
          <Button
            icon={<SlidersHorizontal size={14} aria-hidden="true" />}
            size="sm"
            variant="secondary"
            onClick={() => props.onDetails(title)}
          >
            Details
          </Button>
          <Button
            disabled={createMutation.isPending || !title.trim()}
            icon={
              createMutation.isPending ? (
                <LoaderCircle className="spin" size={14} aria-hidden="true" />
              ) : null
            }
            size="sm"
            type="submit"
          >
            Add task
          </Button>
        </div>
      </div>
      {formError ? <p className="form-error">{formError}</p> : null}
    </form>
  );
}
