import { AlertCircle, Calendar, Check, GitCommitHorizontal, PanelRight } from "lucide-react";
import { useState } from "react";

import {
  groupByPriority,
  type TaskApiStatus,
  type TaskDto,
  type TaskEffort,
  type TaskListDto
} from "@jarv1s/shared";

import { effortLabels } from "./task-format";

/** Stable per-list dot colour (lists carry no colour of their own). */
const LIST_COLORS = [
  "var(--pine)",
  "var(--steel)",
  "var(--amber)",
  "var(--red)",
  "var(--ink-3)",
  "var(--pine-hover)"
];

/** Build a stable listId → {name, color} lookup shared by list + matrix views. */
export function listColorMap(
  lists: readonly TaskListDto[]
): Map<string, { name: string; color: string }> {
  return new Map(
    lists.map((list, index) => [
      list.id,
      { name: list.name, color: LIST_COLORS[index % LIST_COLORS.length] ?? "var(--pine)" }
    ])
  );
}

/** Priority value → criticality colour token (mirrors the design system ramp). */
function priorityColor(value: number | null): string {
  switch (value) {
    case 5:
      return "var(--priority-urgent)";
    case 4:
      return "var(--priority-high)";
    case 3:
      return "var(--priority-medium)";
    case 2:
      return "var(--priority-low)";
    case 1:
      return "var(--priority-minimal)";
    default:
      return "var(--priority-none)";
  }
}

const EFFORT_TICKS: Record<TaskEffort, number> = {
  quick: 1,
  medium: 2,
  large: 3
};

interface DueInfo {
  readonly label: string;
  readonly tone: "" | "overdue" | "today";
  readonly drift: "atrisk" | "overdue" | null;
}

/** Due date → human label + drift signal (system-owned urgency, anti-shame amber). */
function dueInfo(task: TaskDto): DueInfo | null {
  if (!task.dueAt) return null;
  const due = new Date(task.dueAt);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDue = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const dayMs = 86_400_000;
  const done = task.status === "done";

  if (startOfDue < startOfToday) {
    return { label: "Overdue", tone: "overdue", drift: done ? null : "overdue" };
  }
  if (startOfDue === startOfToday) {
    return { label: "Today", tone: "today", drift: null };
  }
  const short = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(due);
  const atRisk = !done && startOfDue - startOfToday <= dayMs * 2;
  return { label: short, tone: "", drift: atRisk ? "atrisk" : null };
}

/** Single effort dot: empty = quick, left-half = medium, full = large (DS "fill" style). */
function EffortDot(props: { readonly effort: TaskEffort }) {
  const ticks = EFFORT_TICKS[props.effort];
  const title = `${effortLabels[props.effort]} effort`;
  return (
    <span className="tk-effort-fill" title={title} aria-label={title}>
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        {ticks === 3 ? <circle cx="7" cy="7" r="5.5" fill="currentColor" stroke="none" /> : null}
        {ticks === 2 ? <path d="M7 1.5 A5.5 5.5 0 0 0 7 12.5 Z" fill="currentColor" /> : null}
      </svg>
    </span>
  );
}

export function TaskListView(props: {
  readonly tasks: readonly TaskDto[];
  readonly lists: readonly TaskListDto[];
  readonly isUpdating: boolean;
  readonly onToggleDone: (task: TaskDto) => void;
  readonly onOpen: (task: TaskDto) => void;
}) {
  const groups = groupByPriority(props.tasks).filter((group) => group.tasks.length > 0);
  const listMeta = listColorMap(props.lists);
  const jarvisCount = props.tasks.filter(
    (task) => task.status !== "done" && isJarvisSource(task.source)
  ).length;

  if (groups.length === 0) {
    return null;
  }

  return (
    <div>
      {groups.map((group) => (
        <div className="tk-panel" key={group.value ?? "none"}>
          <div className="tk-panel__head">
            <span className="tk-panel__dot" style={{ background: priorityColor(group.value) }} />
            <span className="tk-panel__name">{group.label}</span>
            <span className="tk-panel__count">{group.tasks.length}</span>
          </div>
          <div className="tk-panel__body">
            {group.tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                list={listMeta.get(task.listId)}
                isUpdating={props.isUpdating}
                onToggleDone={props.onToggleDone}
                onOpen={props.onOpen}
              />
            ))}
          </div>
        </div>
      ))}
      {jarvisCount > 0 ? (
        <div className="tk-foot">
          <span className="ic">
            <GitCommitHorizontal size={14} aria-hidden="true" />
          </span>
          Jarvis is tracking {jarvisCount} {jarvisCount === 1 ? "task" : "tasks"} it created for you
          — all marked by source.
        </div>
      ) : null}
    </div>
  );
}

export function TaskRow(props: {
  readonly task: TaskDto;
  readonly list?: { readonly name: string; readonly color: string };
  readonly isUpdating: boolean;
  readonly compact?: boolean;
  readonly onToggleDone: (task: TaskDto) => void;
  readonly onOpen: (task: TaskDto) => void;
}) {
  const { task, compact = false } = props;
  const [optimisticDone, setOptimisticDone] = useState(task.status === "done");
  const done = optimisticDone;
  const due = dueInfo(task);
  const tags = compact ? [] : (task.tags ?? []);
  const jarvis = !compact && isJarvisSource(task.source);

  return (
    <div className={`tk-task ${done ? "tk-task--done" : ""}`}>
      <span className="tk-task__bar" style={{ background: priorityColor(task.priority) }} />
      <span className="tk-task__check">
        <label className="jds-check">
          <input
            type="checkbox"
            checked={done}
            disabled={props.isUpdating}
            onChange={() => {
              setOptimisticDone(!optimisticDone);
              props.onToggleDone(task);
            }}
            aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
          />
          <span className="jds-check__box">
            <Check size={13} aria-hidden="true" />
          </span>
        </label>
      </span>
      <button
        type="button"
        className="tk-task__main"
        onClick={() => props.onOpen(task)}
        aria-label={`Open ${task.title}`}
      >
        <span className="tk-task__title">{task.title}</span>
        <span className="tk-task__meta">
          {due ? (
            <span
              className={`tk-meta-due ${due.tone === "overdue" ? "tk-meta-due--overdue" : due.tone === "today" ? "tk-meta-due--today" : ""}`}
            >
              <span className="ic">
                {due.tone === "overdue" ? (
                  <AlertCircle size={12} aria-hidden="true" />
                ) : (
                  <Calendar size={12} aria-hidden="true" />
                )}
              </span>
              {due.label}
            </span>
          ) : null}
          {due?.drift ? (
            <span className={`jds-drift jds-drift--${due.drift}`}>
              <span className="jds-drift__dot" />
              {due.drift === "overdue" ? "Overdue" : "At risk"}
            </span>
          ) : null}
          {props.list ? (
            <span className="tk-listchip">
              <span className="tk-listchip__dot" style={{ background: props.list.color }} />
              {props.list.name}
            </span>
          ) : null}
          {tags.slice(0, 2).map((tag) => (
            <span className="tk-metatag" key={tag.id}>
              #{tag.name}
            </span>
          ))}
          {tags.length > 2 ? <span className="tk-metatag">+{tags.length - 2}</span> : null}
          {jarvis ? (
            <span className="tk-task__src">
              <GitCommitHorizontal size={12} aria-hidden="true" />
              {task.source}
            </span>
          ) : null}
        </span>
      </button>
      <div className="tk-task__right">
        {!compact && task.effort ? <EffortDot effort={task.effort} /> : null}
        <button
          type="button"
          className="tk-task__open"
          onClick={() => props.onOpen(task)}
          aria-label={`Open ${task.title}`}
        >
          <PanelRight size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** A task Jarvis created carries a non-user source (chat, email, briefing, connector…). */
function isJarvisSource(source: string): boolean {
  const s = source.toLowerCase();
  return s !== "" && s !== "user" && s !== "manual";
}

export type { TaskApiStatus };
