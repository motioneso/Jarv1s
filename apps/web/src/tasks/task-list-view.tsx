import { CheckCircle2, Circle } from "lucide-react";
import { Link } from "react-router";

import { groupByPriority, type TaskApiStatus, type TaskDto } from "@jarv1s/shared";

import { effortLabel, formatDate } from "./task-format";

export function TaskListView(props: {
  readonly tasks: readonly TaskDto[];
  readonly isUpdating: boolean;
  readonly onToggleDone: (task: TaskDto) => void;
}) {
  const groups = groupByPriority(props.tasks).filter((group) => group.tasks.length > 0);

  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="task-groups">
      {groups.map((group) => (
        <section
          className="task-group"
          key={group.value ?? "none"}
          aria-label={`${group.label} priority`}
        >
          <header className={`task-group-header priority-${group.value ?? "none"}`}>
            <span>{group.label}</span>
            <span className="task-group-count">{group.tasks.length}</span>
          </header>
          <ul className="task-group-list">
            {group.tasks.map((task) => (
              <TaskLine
                key={task.id}
                task={task}
                isUpdating={props.isUpdating}
                onToggleDone={props.onToggleDone}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function TaskLine(props: {
  readonly task: TaskDto;
  readonly isUpdating: boolean;
  readonly onToggleDone: (task: TaskDto) => void;
}) {
  const done = props.task.status === "done";
  const effort = effortLabel(props.task.effort);

  return (
    <li className={`task-line ${done ? "done" : ""}`}>
      <button
        aria-label={done ? `Reopen ${props.task.title}` : `Complete ${props.task.title}`}
        className="task-check icon-button"
        disabled={props.isUpdating}
        onClick={() => props.onToggleDone(props.task)}
        type="button"
      >
        {done ? <CheckCircle2 size={20} /> : <Circle size={20} />}
      </button>
      <Link className="task-line-title" to={`/tasks/${props.task.id}`}>
        {props.task.title}
      </Link>
      <div className="task-line-meta">
        {props.task.dueAt ? <span className="task-due">{formatDate(props.task.dueAt)}</span> : null}
        {effort ? <span className="task-effort">{effort}</span> : null}
      </div>
    </li>
  );
}

export type { TaskApiStatus };
