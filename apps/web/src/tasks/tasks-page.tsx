import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TaskDefaultView, TaskDto } from "@jarv1s/shared";
import {
  CheckCheck,
  ChevronDown,
  Layers,
  LayoutGrid,
  List as ListIcon,
  LoaderCircle,
  Search,
  Tag
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import {
  getTaskPreferences,
  listTaskLists,
  listTasks,
  updateTask,
  updateTaskPreferences
} from "../api/client";
import { queryKeys } from "../api/query-keys";
import { FOCUS_LABELS, isTaskFocus, matchesFocus } from "./focus";
import { TaskCapture } from "./task-capture";
import { TaskDetailsDialog } from "./task-details-dialog";
import { TaskListView } from "./task-list-view";
import { TaskMatrixView } from "./task-matrix-view";
import { statusLabels } from "./task-format";

const statusFilters = ["all", "todo", "done", "archived"] as const;
type StatusFilter = (typeof statusFilters)[number];
type ListState = "included" | "solo" | "excluded";

export function TasksPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusParam = searchParams.get("focus");
  const focus = isTaskFocus(focusParam) ? focusParam : null;
  const clearFocus = () =>
    setSearchParams(
      (prev) => {
        prev.delete("focus");
        return prev;
      },
      { replace: true }
    );
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todo");
  const [search, setSearch] = useState("");
  const [listStates, setListStates] = useState<Record<string, ListState>>({});
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  // Modal: null = closed; { id: string } = edit; { id: null } = create.
  const [dialog, setDialog] = useState<{ readonly id: string | null } | null>(null);

  const tasksQuery = useQuery({ queryKey: queryKeys.tasks.list, queryFn: () => listTasks() });
  const listsQuery = useQuery({ queryKey: queryKeys.tasks.lists, queryFn: listTaskLists });
  const prefsQuery = useQuery({
    queryKey: queryKeys.tasks.preferences,
    queryFn: getTaskPreferences
  });

  const view: TaskDefaultView = prefsQuery.data?.preferences.defaultView ?? "priority";
  const lists = listsQuery.data?.lists ?? [];
  const allTasks = tasksQuery.data?.tasks ?? [];

  const viewMutation = useMutation({
    mutationFn: (next: TaskDefaultView) => updateTaskPreferences({ defaultView: next }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.preferences });
    }
  });

  const updateMutation = useMutation({
    mutationFn: (task: TaskDto) =>
      updateTask(task.id, { status: task.status === "done" ? "todo" : "done" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.list });
    }
  });

  const stateOf = (listId: string): ListState => listStates[listId] ?? "included";
  const soloIds = lists.filter((list) => stateOf(list.id) === "solo").map((list) => list.id);
  const anySolo = soloIds.length > 0;

  // All tag names present across the loaded tasks (the filterable universe).
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const task of allTasks) for (const tag of task.tags) set.add(tag.name);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [allTasks]);

  const visibleTasks = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allTasks.filter((task) => {
      if (task.parentTaskId !== null) return false; // subtasks live in the detail modal
      if (focus) {
        if (!matchesFocus(task, focus)) return false; // focus preset owns the status logic
      } else if (statusFilter !== "all" && task.status !== statusFilter) {
        return false;
      }
      const st = listStates[task.listId] ?? "included";
      if (st === "excluded") return false;
      if (anySolo && st !== "solo") return false;
      if (tagFilter.length && !tagFilter.some((name) => task.tags.some((t) => t.name === name))) {
        return false;
      }
      if (
        needle &&
        !task.title.toLowerCase().includes(needle) &&
        !(task.description?.toLowerCase().includes(needle) ?? false)
      ) {
        return false;
      }
      return true;
    });
  }, [allTasks, anySolo, focus, listStates, search, statusFilter, tagFilter]);

  // Per-list counts for the dropdown — respect status + tag filters, ignore the list filter.
  const listCounts = useMemo(() => {
    const base = allTasks.filter(
      (task) =>
        task.parentTaskId === null &&
        (statusFilter === "all" || task.status === statusFilter) &&
        (!tagFilter.length || tagFilter.some((name) => task.tags.some((t) => t.name === name)))
    );
    const counts: Record<string, number> = {};
    for (const list of lists) counts[list.id] = base.filter((t) => t.listId === list.id).length;
    return { counts, total: base.length };
  }, [allTasks, lists, statusFilter, tagFilter]);

  const cycleList = (id: string) =>
    setListStates((s) => {
      const cur = s[id] ?? "included";
      const next: ListState =
        cur === "included" ? "solo" : cur === "solo" ? "excluded" : "included";
      return { ...s, [id]: next };
    });

  return (
    <section className="tasks-wrap tasks--comfortable tasks--panels" aria-label="Tasks">
      <div className="tk-bar">
        <div className="jds-segmented" role="group" aria-label="Status filter">
          {statusFilters.map((status) => (
            <button
              aria-pressed={!focus && statusFilter === status}
              className={`jds-segmented__opt ${!focus && statusFilter === status ? "is-active" : ""}`}
              key={status}
              onClick={() => {
                setStatusFilter(status);
                clearFocus();
              }}
              type="button"
            >
              {status === "all" ? "All" : statusLabels[status]}
            </button>
          ))}
        </div>

        <span className="tk-bar__sep" />

        <ListFilterMenu
          lists={lists}
          stateOf={stateOf}
          soloIds={soloIds}
          counts={listCounts.counts}
          allCount={listCounts.total}
          onCycle={cycleList}
          onReset={() => setListStates({})}
        />

        <TagFilter
          all={allTags}
          active={tagFilter}
          onAdd={(name) => setTagFilter((a) => (a.includes(name) ? a : [...a, name]))}
        />

        <label className="tk-tagfield">
          <span className="ic">
            <Search size={14} aria-hidden="true" />
          </span>
          <input
            aria-label="Search tasks"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search tasks…"
            type="search"
            value={search}
          />
        </label>

        <span className="tk-bar__spacer" />

        <div className="jds-segmented" role="group" aria-label="View">
          <button
            aria-pressed={view === "priority"}
            className={`jds-segmented__opt ${view === "priority" ? "is-active" : ""}`}
            disabled={viewMutation.isPending}
            onClick={() => viewMutation.mutate("priority")}
            type="button"
          >
            <ListIcon size={15} aria-hidden="true" /> List
          </button>
          <button
            aria-pressed={view === "matrix"}
            className={`jds-segmented__opt ${view === "matrix" ? "is-active" : ""}`}
            disabled={viewMutation.isPending}
            onClick={() => viewMutation.mutate("matrix")}
            type="button"
          >
            <LayoutGrid size={15} aria-hidden="true" /> Matrix
          </button>
        </div>
      </div>

      {focus ? (
        <div className="tk-activetags">
          <span className="tk-activetags__lbl">Focus</span>
          <span className="jds-chip">
            {FOCUS_LABELS[focus]}
            <button
              type="button"
              className="jds-chip__x"
              aria-label="Clear focus"
              onClick={clearFocus}
            >
              <svg
                viewBox="0 0 24 24"
                width="13"
                height="13"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </span>
        </div>
      ) : null}

      {tagFilter.length > 0 ? (
        <div className="tk-activetags">
          <span className="tk-activetags__lbl">Tags</span>
          {tagFilter.map((name) => (
            <span key={name} className="jds-chip">
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-faint)" }}>#</span>
              {name}
              <button
                type="button"
                className="jds-chip__x"
                aria-label={`Remove ${name}`}
                onClick={() => setTagFilter((a) => a.filter((x) => x !== name))}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="13"
                  height="13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
          <button type="button" className="tk-activetags__clear" onClick={() => setTagFilter([])}>
            Clear
          </button>
        </div>
      ) : null}

      <TaskCapture
        defaultListId={soloIds.length === 1 ? soloIds[0] : undefined}
        onDetails={() => setDialog({ id: null })}
      />

      {tasksQuery.isLoading ? (
        <div className="tk-empty">
          <span className="tk-empty__mark">
            <LoaderCircle className="spin" size={24} aria-hidden="true" />
          </span>
          <div className="tk-empty__title">Loading tasks</div>
        </div>
      ) : visibleTasks.length === 0 ? (
        <div className="tk-empty">
          <span className="tk-empty__mark">
            <CheckCheck size={24} aria-hidden="true" />
          </span>
          <div className="tk-empty__title">No tasks match</div>
          <div className="tk-empty__sub">Try clearing a filter or two.</div>
        </div>
      ) : view === "matrix" ? (
        <TaskMatrixView
          tasks={visibleTasks}
          lists={lists}
          isUpdating={updateMutation.isPending}
          onToggleDone={(task) => updateMutation.mutate(task)}
          onOpen={(task) => setDialog({ id: task.id })}
        />
      ) : (
        <TaskListView
          tasks={visibleTasks}
          lists={lists}
          isUpdating={updateMutation.isPending}
          onToggleDone={(task) => updateMutation.mutate(task)}
          onOpen={(task) => setDialog({ id: task.id })}
        />
      )}

      {dialog ? (
        <TaskDetailsDialog
          open
          taskId={dialog.id}
          defaultListId={soloIds.length === 1 ? soloIds[0] : lists[0]?.id}
          currentUserLabel="You"
          lists={lists}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </section>
  );
}

/** Lists filter — tri-state per list: include → solo (focus, dim others) → exclude (hide). */
function ListFilterMenu(props: {
  readonly lists: readonly { readonly id: string; readonly name: string }[];
  readonly stateOf: (id: string) => ListState;
  readonly soloIds: readonly string[];
  readonly counts: Record<string, number>;
  readonly allCount: number;
  readonly onCycle: (id: string) => void;
  readonly onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const excluded = props.lists.filter((list) => props.stateOf(list.id) === "excluded");
  const anySolo = props.soloIds.length > 0;
  const clean = !anySolo && excluded.length === 0;
  const soloed = props.lists.filter((list) => props.stateOf(list.id) === "solo");

  let label = "All lists";
  let hidden = 0;
  if (soloed.length === 1) label = soloed[0]?.name ?? "All lists";
  else if (soloed.length > 1) label = `${soloed.length} lists`;
  else if (excluded.length) hidden = excluded.length;

  return (
    <div className="tk-listfilter" ref={ref}>
      <button
        type="button"
        className={`tk-listbtn ${open ? "is-open" : ""} ${!clean ? "is-on" : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Layers size={14} aria-hidden="true" />
        {label}
        {hidden ? <span className="tk-listbtn__hidden"> · {hidden} hidden</span> : null}
        <span className="tk-listbtn__chev">
          <ChevronDown size={14} aria-hidden="true" />
        </span>
      </button>
      {open ? (
        <div className="tk-tagmenu" style={{ minWidth: 234 }}>
          <button
            type="button"
            className={`tk-tagmenu__item ${clean ? "is-active" : ""}`}
            onClick={props.onReset}
          >
            <Layers size={14} aria-hidden="true" />
            <span className="nm">All lists</span>
            <span className="ct">{props.allCount}</span>
          </button>
          <div className="tk-tagmenu__hd">Your lists</div>
          {props.lists.map((list) => {
            const st = props.stateOf(list.id);
            const cls =
              st === "solo"
                ? "is-solo"
                : st === "excluded"
                  ? "is-excluded"
                  : anySolo
                    ? "is-dim"
                    : "";
            return (
              <button
                key={list.id}
                type="button"
                className={`tk-tagmenu__item ${cls}`}
                onClick={() => props.onCycle(list.id)}
              >
                <span className="tk-listbtn__dot" style={{ background: "var(--pine)" }} />
                <span className="nm">{list.name}</span>
                {st === "solo" ? (
                  <span className="tk-liststate tk-liststate--only">Only</span>
                ) : st === "excluded" ? (
                  <span className="tk-liststate tk-liststate--hidden">Hidden</span>
                ) : null}
                <span className="ct">{props.counts[list.id] ?? 0}</span>
              </button>
            );
          })}
          <div className="tk-tagmenu__hint">
            Click to focus a list · again to hide it · again to reset
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Tag filter — type to narrow, pick to add (OR across selected tags). */
function TagFilter(props: {
  readonly all: readonly string[];
  readonly active: readonly string[];
  readonly onAdd: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const matches = props.all.filter(
    (name) => !props.active.includes(name) && name.includes(query.trim().toLowerCase())
  );

  const pick = (name: string) => {
    props.onAdd(name);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="tk-tagfilter">
      <div className="tk-tagfield">
        <span className="ic">
          <Tag size={14} aria-hidden="true" />
        </span>
        <input
          value={query}
          placeholder="Filter by tag…"
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 140)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches.length) {
              event.preventDefault();
              pick(matches[0] ?? "");
            }
          }}
        />
      </div>
      {open ? (
        <div className="tk-tagmenu">
          <div className="tk-tagmenu__hd">{query ? "Matching tags" : "All tags"}</div>
          {matches.length ? (
            matches.map((name) => (
              <button
                key={name}
                type="button"
                className="tk-tagmenu__item"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(name)}
              >
                <span className="hash">#</span>
                {name}
              </button>
            ))
          ) : (
            <div className="tk-tagmenu__empty">No more tags{query ? ` for “${query}”` : ""}.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
