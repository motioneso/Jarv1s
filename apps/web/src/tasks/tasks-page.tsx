import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TaskDefaultView, TaskDto } from "@jarv1s/shared";
import { LayoutGrid, List as ListIcon, LoaderCircle, Plus, Search } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

import {
  createTaskList,
  createTaskTag,
  getTaskPreferences,
  listTaskLists,
  listTasks,
  listTaskTags,
  updateTask,
  updateTaskPreferences
} from "../api/client";
import { queryKeys } from "../api/query-keys";
import { TaskCapture } from "./task-capture";
import { TaskListView } from "./task-list-view";
import { TaskMatrixView } from "./task-matrix-view";
import { statusLabels } from "./task-format";

const statusFilters = ["all", "todo", "done", "archived"] as const;
type StatusFilter = (typeof statusFilters)[number];

export function TasksPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todo");
  const [search, setSearch] = useState("");
  const [activeListId, setActiveListId] = useState<string | null>(null);

  const tasksQuery = useQuery({ queryKey: queryKeys.tasks.list, queryFn: () => listTasks() });
  const listsQuery = useQuery({ queryKey: queryKeys.tasks.lists, queryFn: listTaskLists });
  const prefsQuery = useQuery({
    queryKey: queryKeys.tasks.preferences,
    queryFn: getTaskPreferences
  });

  const view: TaskDefaultView = prefsQuery.data?.preferences.defaultView ?? "priority";

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

  const visibleTasks = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (tasksQuery.data?.tasks ?? []).filter((task) => {
      if (task.parentTaskId !== null) return false; // subtasks render on the detail page
      if (activeListId && task.listId !== activeListId) return false;
      if (statusFilter !== "all" && task.status !== statusFilter) return false;
      if (
        needle &&
        !task.title.toLowerCase().includes(needle) &&
        !(task.description?.toLowerCase().includes(needle) ?? false)
      ) {
        return false;
      }
      return true;
    });
  }, [activeListId, search, statusFilter, tasksQuery.data?.tasks]);

  return (
    <section className="page-stack" aria-labelledby="tasks-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Tasks</p>
          <h1 id="tasks-title">Tasks</h1>
        </div>
        <div className="segmented-control" role="group" aria-label="View">
          <button
            aria-pressed={view === "priority"}
            className={view === "priority" ? "active" : ""}
            disabled={viewMutation.isPending}
            onClick={() => viewMutation.mutate("priority")}
            type="button"
          >
            <ListIcon size={16} aria-hidden="true" /> Priority
          </button>
          <button
            aria-pressed={view === "matrix"}
            className={view === "matrix" ? "active" : ""}
            disabled={viewMutation.isPending}
            onClick={() => viewMutation.mutate("matrix")}
            type="button"
          >
            <LayoutGrid size={16} aria-hidden="true" /> Matrix
          </button>
        </div>
      </div>

      <div className="panel">
        <TaskCapture defaultListId={activeListId ?? undefined} />
      </div>

      <div className="tasks-body">
        <aside className="tasks-sidebar" aria-label="Lists">
          <ListSidebar
            activeListId={activeListId}
            lists={listsQuery.data?.lists ?? []}
            onSelect={setActiveListId}
          />
        </aside>

        <div className="tasks-main">
          <section className="task-toolbar" aria-label="Filters">
            <div className="segmented-control wide" aria-label="Status filter">
              {statusFilters.map((status) => (
                <button
                  className={statusFilter === status ? "active" : ""}
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  type="button"
                >
                  {status === "all" ? "All" : statusLabels[status]}
                </button>
              ))}
            </div>
            <label className="search-box">
              <Search size={18} aria-hidden="true" />
              <input
                aria-label="Search tasks"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search tasks"
                type="search"
                value={search}
              />
            </label>
          </section>

          {tasksQuery.isLoading ? (
            <div className="empty-state">
              <LoaderCircle className="spin" size={22} aria-hidden="true" />
              <p>Loading tasks</p>
            </div>
          ) : visibleTasks.length === 0 ? (
            <div className="empty-state">
              <p>No tasks</p>
            </div>
          ) : view === "matrix" ? (
            <TaskMatrixView
              tasks={visibleTasks}
              isUpdating={updateMutation.isPending}
              onToggleDone={(task) => updateMutation.mutate(task)}
            />
          ) : (
            <TaskListView
              tasks={visibleTasks}
              isUpdating={updateMutation.isPending}
              onToggleDone={(task) => updateMutation.mutate(task)}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function ListSidebar(props: {
  readonly lists: readonly { readonly id: string; readonly name: string }[];
  readonly activeListId: string | null;
  readonly onSelect: (id: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [newList, setNewList] = useState("");
  const [newTag, setNewTag] = useState("");

  const createListMutation = useMutation({
    mutationFn: () => createTaskList({ name: newList.trim() }),
    onSuccess: async () => {
      setNewList("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.lists });
    }
  });

  const tagsQuery = useQuery({
    enabled: Boolean(props.activeListId),
    queryKey: queryKeys.tasks.tags(props.activeListId ?? ""),
    queryFn: () => listTaskTags(props.activeListId ?? "")
  });

  const createTagMutation = useMutation({
    mutationFn: () => createTaskTag(props.activeListId ?? "", { name: newTag.trim() }),
    onSuccess: async () => {
      setNewTag("");
      if (props.activeListId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.tags(props.activeListId) });
      }
    }
  });

  const submitList = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newList.trim()) createListMutation.mutate();
  };
  const submitTag = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newTag.trim() && props.activeListId) createTagMutation.mutate();
  };

  return (
    <>
      <h2 className="sidebar-title">Lists</h2>
      <ul className="list-nav">
        <li>
          <button
            className={props.activeListId === null ? "active" : ""}
            onClick={() => props.onSelect(null)}
            type="button"
          >
            All
          </button>
        </li>
        {props.lists.map((list) => (
          <li key={list.id}>
            <button
              className={props.activeListId === list.id ? "active" : ""}
              onClick={() => props.onSelect(list.id)}
              type="button"
            >
              {list.name}
            </button>
          </li>
        ))}
      </ul>

      <form className="sidebar-form" onSubmit={submitList}>
        <input
          aria-label="New list name"
          onChange={(event) => setNewList(event.target.value)}
          placeholder="New list"
          type="text"
          value={newList}
        />
        <button
          aria-label="Add list"
          className="icon-button"
          disabled={createListMutation.isPending}
          type="submit"
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </form>

      {props.activeListId ? (
        <div className="sidebar-tags">
          <h3 className="sidebar-subtitle">Tags</h3>
          <ul className="tag-list">
            {(tagsQuery.data?.tags ?? []).map((tag) => (
              <li className="tag-chip" key={tag.id}>
                {tag.name}
              </li>
            ))}
          </ul>
          <form className="sidebar-form" onSubmit={submitTag}>
            <input
              aria-label="New tag name"
              onChange={(event) => setNewTag(event.target.value)}
              placeholder="New tag"
              type="text"
              value={newTag}
            />
            <button
              aria-label="Add tag"
              className="icon-button"
              disabled={createTagMutation.isPending}
              type="submit"
            >
              <Plus size={16} aria-hidden="true" />
            </button>
          </form>
        </div>
      ) : null}
    </>
  );
}
