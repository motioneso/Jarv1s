import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GitCommitHorizontal } from "lucide-react";

import type { LocaleSettingsDto, TaskDto } from "@jarv1s/shared";
import { Button } from "@jarv1s/ui";

import { updateTask } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { formatDate } from "../locale/locale-format";

function shortDate(iso: string, locale: LocaleSettingsDto): string {
  return formatDate(iso, locale, { month: "short", day: "numeric" });
}

export function SuggestedFromEmailSection(props: {
  readonly tasks: readonly TaskDto[];
  readonly locale: LocaleSettingsDto;
  readonly onOpen: (taskId: string) => void;
}) {
  const queryClient = useQueryClient();
  const triageMutation = useMutation({
    mutationFn: (input: { readonly task: TaskDto; readonly status: "todo" | "archived" }) =>
      updateTask(input.task.id, { status: input.status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.list });
    }
  });

  if (props.tasks.length === 0) return null;

  return (
    <section className="jds-brief">
      <div className="jds-brief__head">
        <span className="jds-brief__kicker">Suggested from email</span>
      </div>
      <div className="jds-brief__title">Waiting for your say-so</div>
      <div className="loose">
        {props.tasks.map((task) => (
          <div className="jds-task" key={task.id}>
            <span className="jds-task__check">
              <GitCommitHorizontal size={15} aria-hidden="true" />
            </span>
            <button type="button" className="jds-task__main" onClick={() => props.onOpen(task.id)}>
              <div className="jds-task__title">{task.title}</div>
              <div className="jds-task__meta">
                <span className="jds-task__source">
                  {task.dueAt ? `Due ${shortDate(task.dueAt, props.locale)}` : task.source}
                </span>
              </div>
            </button>
            <div style={{ display: "flex", gap: 8, alignSelf: "center" }}>
              <Button
                variant="secondary"
                size="sm"
                disabled={triageMutation.isPending}
                onClick={() => triageMutation.mutate({ task, status: "todo" })}
              >
                Accept
              </Button>
              <Button
                variant="quiet"
                size="sm"
                disabled={triageMutation.isPending}
                onClick={() => triageMutation.mutate({ task, status: "archived" })}
              >
                Dismiss
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
