import { CheckCircle2, Circle } from "lucide-react";
import { Link } from "react-router";

import { QUADRANTS, quadrantTasks, type TaskDto } from "@jarv1s/shared";

export function TaskMatrixView(props: {
  readonly tasks: readonly TaskDto[];
  readonly isUpdating: boolean;
  readonly onToggleDone: (task: TaskDto) => void;
}) {
  return (
    <div className="task-matrix" role="grid" aria-label="Eisenhower matrix">
      {QUADRANTS.map((quadrant) => {
        const tasks = quadrantTasks(props.tasks, quadrant.key);
        return (
          <section
            className={`matrix-cell matrix-${quadrant.key}`}
            key={quadrant.key}
            role="gridcell"
          >
            <header className="matrix-cell-header">
              <span className="matrix-cell-title">{quadrant.title}</span>
              <span className="matrix-cell-subtitle">{quadrant.subtitle}</span>
            </header>
            {tasks.length === 0 ? (
              <p className="matrix-empty">Nothing here</p>
            ) : (
              <ul className="matrix-cell-list">
                {tasks.map((task) => (
                  <li className={`task-line ${task.status === "done" ? "done" : ""}`} key={task.id}>
                    <button
                      aria-label={
                        task.status === "done" ? `Reopen ${task.title}` : `Complete ${task.title}`
                      }
                      className="task-check icon-button"
                      disabled={props.isUpdating}
                      onClick={() => props.onToggleDone(task)}
                      type="button"
                    >
                      {task.status === "done" ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                    </button>
                    <Link className="task-line-title" to={`/tasks/${task.id}`}>
                      {task.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
