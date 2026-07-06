import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GitCommitHorizontal } from "lucide-react";

import type { LocaleSettingsDto, TaskDto } from "@jarv1s/shared";

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
          <div className="loose-row" key={task.id} style={{ cursor: "default" }}>
            <span className="loose-row__ic">
              <GitCommitHorizontal size={15} aria-hidden="true" />
            </span>
            <button
              type="button"
              className="loose-row__main"
              style={{
                background: "transparent",
                border: "none",
                font: "inherit",
                color: "inherit",
                cursor: "pointer",
                textAlign: "left",
                padding: 0
              }}
              onClick={() => props.onOpen(task.id)}
            >
              <div className="loose-row__title">{task.title}</div>
              <div className="loose-row__meta">
                {task.dueAt ? `Due ${shortDate(task.dueAt, props.locale)}` : task.source}
              </div>
            </button>
            <div className="loose-row__act" style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="jds-btn jds-btn--sm jds-btn--secondary"
                disabled={triageMutation.isPending}
                onClick={() => triageMutation.mutate({ task, status: "todo" })}
              >
                Accept
              </button>
              <button
                type="button"
                className="jds-btn jds-btn--sm jds-btn--quiet"
                disabled={triageMutation.isPending}
                onClick={() => triageMutation.mutate({ task, status: "archived" })}
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
