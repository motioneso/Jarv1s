import { QUADRANTS, type TaskDto, type TaskListDto } from "@jarv1s/shared";

import { listColorMap, TaskRow } from "./task-list-view";
import { groupTasksByQuadrant } from "./task-view-model";

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
  const tasksByQuadrant = groupTasksByQuadrant(props.tasks);

  return (
    <div>
      <div className="tk-matrix" role="grid" aria-label="Eisenhower matrix">
        {QUADRANTS.map((quadrant) => {
          const tasks = tasksByQuadrant[quadrant.key];
          return (
            <div className={`tk-quad tk-quad--${quadrant.key}`} key={quadrant.key} role="gridcell">
              <div className="tk-quad__head">
                <span className="tk-quad__n">{tasks.length}</span>
                <span className="tk-quad__tag">
                  <span className="dot" />
                  {QUAD_TAG[quadrant.key]}
                </span>
                <div className="tk-quad__verb">{quadrant.title}</div>
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
