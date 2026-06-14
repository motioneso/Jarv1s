import { LayoutGrid } from "lucide-react";

import { QUADRANTS, quadrantTasks, type TaskDto, type TaskListDto } from "@jarv1s/shared";

import { listColorMap, TaskRow } from "./task-list-view";

/** Mono kicker per Eisenhower quadrant (importance × urgency). */
const QUAD_TAG: Record<string, string> = {
  do: "IMPORTANT · URGENT",
  schedule: "IMPORTANT",
  delegate: "URGENT",
  eliminate: "NEITHER"
};

export function TaskMatrixView(props: {
  readonly tasks: readonly TaskDto[];
  readonly lists: readonly TaskListDto[];
  readonly isUpdating: boolean;
  readonly onToggleDone: (task: TaskDto) => void;
  readonly onOpen: (task: TaskDto) => void;
}) {
  const listMeta = listColorMap(props.lists);

  return (
    <div>
      <div className="tk-matrix-cap">
        <span className="ic">
          <LayoutGrid size={14} aria-hidden="true" />
        </span>
        Your tasks sorted by importance (priority) and urgency (whether they have a due date).
      </div>
      <div className="tk-matrix" role="grid" aria-label="Eisenhower matrix">
        {QUADRANTS.map((quadrant) => {
          const tasks = quadrantTasks(props.tasks, quadrant.key);
          return (
            <div className={`tk-quad tk-quad--${quadrant.key}`} key={quadrant.key} role="gridcell">
              <div className="tk-quad__head">
                <span className="tk-quad__n">{tasks.length}</span>
                <span className="tk-quad__tag">
                  <span className="dot" />
                  {QUAD_TAG[quadrant.key]}
                </span>
                <div className="tk-quad__verb">{quadrant.title}</div>
                <div className="tk-quad__desc">{quadrant.subtitle}</div>
              </div>
              <div className="tk-quad__body">
                {tasks.length === 0 ? (
                  <div className="tk-quad__empty">
                    Nothing here{quadrant.key === "eliminate" ? " — a clean corner." : "."}
                  </div>
                ) : (
                  tasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      list={listMeta.get(task.listId)}
                      isUpdating={props.isUpdating}
                      compact
                      onToggleDone={props.onToggleDone}
                      onOpen={props.onOpen}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
