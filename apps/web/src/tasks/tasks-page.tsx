import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TaskDefaultView, TaskDto, TaskTagDto } from "@jarv1s/shared";
import {
  Check,
  LayoutGrid,
  List as ListIcon,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
  X
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

import {
  ApiError,
  createTaskList,
  createTaskTag,
  deleteTaskList,
  deleteTaskTag,
  getTaskPreferences,
  listTaskLists,
  listTasks,
  listTaskTags,
  renameTaskList,
  renameTaskTag,
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
          <ListRow
            activeListId={props.activeListId}
            allLists={props.lists}
            key={list.id}
            list={list}
            onSelect={props.onSelect}
          />
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
              <TagRow key={tag.id} listId={props.activeListId ?? ""} tag={tag} />
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

function ListRow(props: {
  readonly list: { readonly id: string; readonly name: string };
  readonly allLists: readonly { readonly id: string; readonly name: string }[];
  readonly activeListId: string | null;
  readonly onSelect: (id: string | null) => void;
}) {
  const { list } = props;
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(list.name);
  const [notEmpty, setNotEmpty] = useState(false);
  const [reassignTo, setReassignTo] = useState("");

  const otherLists = props.allLists.filter((other) => other.id !== list.id);

  const renameMutation = useMutation({
    mutationFn: () => renameTaskList(list.id, { name: name.trim() }),
    onSuccess: async () => {
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.lists });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (reassignToListId?: string) =>
      deleteTaskList(list.id, reassignToListId ? { reassignToListId } : undefined),
    onSuccess: async () => {
      setNotEmpty(false);
      if (props.activeListId === list.id) props.onSelect(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.lists }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.list })
      ]);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        setNotEmpty(true);
      }
    }
  });

  if (editing) {
    return (
      <li className="list-row editing">
        <form
          className="sidebar-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) renameMutation.mutate();
          }}
        >
          <input
            aria-label={`Rename list ${list.name}`}
            onChange={(event) => setName(event.target.value)}
            type="text"
            value={name}
          />
          <button aria-label="Save list name" className="icon-button" type="submit">
            <Check size={16} aria-hidden="true" />
          </button>
          <button
            aria-label="Cancel rename"
            className="icon-button"
            onClick={() => {
              setEditing(false);
              setName(list.name);
            }}
            type="button"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </form>
      </li>
    );
  }

  return (
    <li className="list-row">
      <button
        className={props.activeListId === list.id ? "active" : ""}
        onClick={() => props.onSelect(list.id)}
        type="button"
      >
        {list.name}
      </button>
      <button
        aria-label={`Rename list ${list.name}`}
        className="icon-button"
        onClick={() => {
          setName(list.name);
          setEditing(true);
        }}
        type="button"
      >
        <Pencil size={14} aria-hidden="true" />
      </button>
      <button
        aria-label={`Delete list ${list.name}`}
        className="icon-button"
        disabled={deleteMutation.isPending}
        onClick={() => deleteMutation.mutate(undefined)}
        type="button"
      >
        <Trash2 size={14} aria-hidden="true" />
      </button>
      {notEmpty ? (
        <div className="list-reassign" role="alert">
          <p className="form-error">List is not empty.</p>
          {otherLists.length > 0 ? (
            <form
              className="sidebar-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (reassignTo) deleteMutation.mutate(reassignTo);
              }}
            >
              <select
                aria-label="Reassign tasks to list"
                onChange={(event) => setReassignTo(event.target.value)}
                value={reassignTo}
              >
                <option value="">Move tasks to…</option>
                {otherLists.map((other) => (
                  <option key={other.id} value={other.id}>
                    {other.name}
                  </option>
                ))}
              </select>
              <button
                className="icon-button"
                aria-label="Confirm delete and reassign"
                disabled={!reassignTo || deleteMutation.isPending}
                type="submit"
              >
                <Check size={16} aria-hidden="true" />
              </button>
            </form>
          ) : (
            <p className="empty-hint">No other list to move tasks to.</p>
          )}
        </div>
      ) : null}
    </li>
  );
}

function TagRow(props: { readonly listId: string; readonly tag: TaskTagDto }) {
  const { listId, tag } = props;
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.name);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.tasks.tags(listId) });

  const renameMutation = useMutation({
    mutationFn: () => renameTaskTag(listId, tag.id, { name: name.trim() }),
    onSuccess: async () => {
      setEditing(false);
      await invalidate();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTaskTag(listId, tag.id),
    onSuccess: async () => {
      await Promise.all([
        invalidate(),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.list })
      ]);
    }
  });

  if (editing) {
    return (
      <li className="tag-chip editing">
        <form
          className="tag-edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) renameMutation.mutate();
          }}
        >
          <input
            aria-label={`Rename tag ${tag.name}`}
            onChange={(event) => setName(event.target.value)}
            type="text"
            value={name}
          />
          <button aria-label="Save tag name" className="tag-chip-action" type="submit">
            <Check size={12} aria-hidden="true" />
          </button>
          <button
            aria-label="Cancel rename"
            className="tag-chip-action"
            onClick={() => {
              setEditing(false);
              setName(tag.name);
            }}
            type="button"
          >
            <X size={12} aria-hidden="true" />
          </button>
        </form>
      </li>
    );
  }

  return (
    <li className="tag-chip">
      {tag.name}
      <button
        aria-label={`Rename tag ${tag.name}`}
        className="tag-chip-action"
        onClick={() => {
          setName(tag.name);
          setEditing(true);
        }}
        type="button"
      >
        <Pencil size={12} aria-hidden="true" />
      </button>
      <button
        aria-label={`Delete tag ${tag.name}`}
        className="tag-chip-action"
        disabled={deleteMutation.isPending}
        onClick={() => deleteMutation.mutate()}
        type="button"
      >
        <X size={12} aria-hidden="true" />
      </button>
    </li>
  );
}
