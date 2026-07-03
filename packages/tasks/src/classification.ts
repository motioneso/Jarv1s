/**
 * The single definition of the Eisenhower quadrants in terms of the two axes
 * (important × urgent). The SQL quadrant filter in {@link TasksRepository} derives
 * its predicates from this matrix and the shared threshold/window constants
 * re-exported below, and the in-memory mirror for the frontend lives in
 * `@jarv1s/shared` (`quadrantOf`). Change the rule in `@jarv1s/shared` and both
 * the backend SQL path and the frontend classifier follow, so neither can drift
 * from the other. This module exists to give the tasks package one import surface
 * for those shared symbols.
 */
export {
  TASK_IMPORTANT_PRIORITY_MIN,
  TASK_QUADRANT_AXES,
  TASK_URGENCY_WINDOW_HOURS,
  TASK_URGENCY_WINDOW_MS,
  type TaskQuadrant
} from "@jarv1s/shared";
