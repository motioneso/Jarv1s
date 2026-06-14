import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowUp, Check, ChevronDown, Circle, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  PRIORITY_LEVELS,
  type TaskActivityDto,
  type TaskApiStatus,
  type TaskListDto
} from "@jarv1s/shared";

import {
  addTaskActivity,
  assignTaskTag,
  breakdownTask,
  createTask,
  createTaskTag,
  getTask,
  listSubtasks,
  listTaskActivity,
  listTaskTags,
  unassignTaskTag,
  updateTask
} from "../api/client";
import { queryKeys } from "../api/query-keys";
import { fromDateInputValue, toDateInputValue } from "./task-format";

const EFFORTS: readonly { readonly value: "quick" | "medium" | "large"; readonly label: string }[] =
  [
    { value: "quick", label: "Small" },
    { value: "medium", label: "Medium" },
    { value: "large", label: "Large" }
  ];

type Repeat = "never" | "daily" | "weekly" | "monthly";
const REPEATS: readonly { readonly value: Repeat; readonly label: string }[] = [
  { value: "never", label: "Never" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" }
];

const AVA_PALETTE = ["var(--steel)", "var(--amber)", "var(--ink-3)"];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0]?.[0] ?? "?").toUpperCase();
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

function avaColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i)) % AVA_PALETTE.length;
  return AVA_PALETTE[h] ?? "var(--steel)";
}

function Ava(props: { readonly name: string; readonly size?: number }) {
  const size = props.size ?? 24;
  return (
    <span
      className="tk-ava"
      style={{
        width: size,
        height: size,
        background: avaColor(props.name),
        fontSize: Math.round(size * 0.4)
      }}
    >
      {initialsOf(props.name)}
    </span>
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(iso)
  );
}

interface FormState {
  title: string;
  description: string;
  status: TaskApiStatus;
  listId: string;
  priority: string;
  dueAt: string;
  doAt: string;
  effort: "" | "quick" | "medium" | "large";
  repeat: Repeat;
  repeatEnd: string;
}

const BLANK: FormState = {
  title: "",
  description: "",
  status: "todo",
  listId: "",
  priority: "",
  dueAt: "",
  doAt: "",
  effort: "",
  repeat: "never",
  repeatEnd: ""
};

export function TaskDetailsDialog(props: {
  readonly open: boolean;
  readonly taskId: string | null;
  readonly defaultListId?: string;
  readonly currentUserLabel: string;
  readonly lists: readonly TaskListDto[];
  readonly onClose: () => void;
}) {
  const isNew = props.taskId === null;
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(BLANK);
  // New-task local collections (attached after the task is created).
  const [newTags, setNewTags] = useState<string[]>([]);
  const [newSubs, setNewSubs] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [subDraft, setSubDraft] = useState("");
  const [comment, setComment] = useState("");

  const enabled = props.open && !isNew && props.taskId !== null;
  const taskQuery = useQuery({
    enabled,
    queryKey: queryKeys.tasks.detail(props.taskId ?? ""),
    queryFn: () => getTask(props.taskId ?? "")
  });
  const subtasksQuery = useQuery({
    enabled,
    queryKey: queryKeys.tasks.subtasks(props.taskId ?? ""),
    queryFn: () => listSubtasks(props.taskId ?? "")
  });
  const activityQuery = useQuery({
    enabled,
    queryKey: queryKeys.tasks.activity(props.taskId ?? ""),
    queryFn: () => listTaskActivity(props.taskId ?? "")
  });
  const task = taskQuery.data?.task;
  const tagsListId = task?.listId ?? form.listId;
  const listTagsQuery = useQuery({
    enabled: props.open && Boolean(tagsListId),
    queryKey: queryKeys.tasks.tags(tagsListId),
    queryFn: () => listTaskTags(tagsListId)
  });

  // Seed the form whenever the dialog opens (or the loaded task changes).
  useEffect(() => {
    if (!props.open) return;
    if (isNew) {
      setForm({ ...BLANK, listId: props.defaultListId ?? "" });
      setNewTags([]);
      setNewSubs([]);
    } else if (task) {
      setForm({
        title: task.title,
        description: task.description ?? "",
        status: task.status,
        listId: task.listId,
        priority: task.priority === null ? "" : String(task.priority),
        dueAt: toDateInputValue(task.dueAt),
        doAt: toDateInputValue(task.doAt),
        effort: task.effort ?? "",
        // The task DTO doesn't surface the current recurrence, so the picker starts
        // at "Never"; choosing a value writes a fresh schedule on save.
        repeat: "never",
        repeatEnd: ""
      });
    }
    setTagDraft("");
    setSubDraft("");
    setComment("");
  }, [props.open, isNew, task, props.defaultListId]);

  const invalidateLists = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.list }),
      props.taskId
        ? queryClient.invalidateQueries({ queryKey: queryKeys.tasks.detail(props.taskId) })
        : Promise.resolve()
    ]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const fields = {
        title: form.title.trim() || "Untitled task",
        description: form.description || null,
        status: form.status,
        priority: form.priority ? Number(form.priority) : null,
        dueAt: fromDateInputValue(form.dueAt),
        doAt: fromDateInputValue(form.doAt),
        effort: (form.effort || null) as "quick" | "medium" | "large" | null,
        listId: form.listId || props.defaultListId || undefined,
        recurrence:
          form.repeat === "never"
            ? null
            : {
                freq: form.repeat,
                interval: 1,
                ...(form.repeatEnd ? { until: fromDateInputValue(form.repeatEnd) } : {})
              }
      };
      if (isNew) {
        const created = await createTask(fields);
        const newId = created.task.id;
        const subs = newSubs.map((s) => s.trim()).filter(Boolean);
        if (subs.length > 0) await breakdownTask(newId, { steps: subs });
        for (const name of newTags) {
          const { tag } = await createTaskTag(created.task.listId, { name });
          await assignTaskTag(newId, { tagId: tag.id });
        }
        return;
      }
      if (props.taskId) await updateTask(props.taskId, fields);
    },
    onSuccess: async () => {
      await invalidateLists();
      props.onClose();
    }
  });

  const toggleSubMutation = useMutation({
    mutationFn: (vars: { readonly id: string; readonly status: TaskApiStatus }) =>
      updateTask(vars.id, { status: vars.status }),
    onSuccess: async () => {
      if (props.taskId)
        await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.subtasks(props.taskId) });
    }
  });

  const addSubMutation = useMutation({
    mutationFn: (text: string) => breakdownTask(props.taskId ?? "", { steps: [text] }),
    onSuccess: async () => {
      setSubDraft("");
      if (props.taskId)
        await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.subtasks(props.taskId) });
    }
  });

  const assignTagMutation = useMutation({
    mutationFn: async (name: string) => {
      const existing = (listTagsQuery.data?.tags ?? []).find(
        (t) => t.name.toLowerCase() === name.toLowerCase()
      );
      const tagId = existing ? existing.id : (await createTaskTag(tagsListId, { name })).tag.id;
      return assignTaskTag(props.taskId ?? "", { tagId });
    },
    onSuccess: async () => {
      setTagDraft("");
      await Promise.all([
        invalidateLists(),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.tags(tagsListId) })
      ]);
    }
  });

  const unassignTagMutation = useMutation({
    mutationFn: (tagId: string) => unassignTaskTag(props.taskId ?? "", tagId),
    onSuccess: invalidateLists
  });

  const commentMutation = useMutation({
    mutationFn: (body: string) =>
      addTaskActivity(props.taskId ?? "", { activityType: "comment", body }),
    onSuccess: async () => {
      setComment("");
      if (props.taskId)
        await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.activity(props.taskId) });
    }
  });

  if (!props.open) return null;

  const subs = subtasksQuery.data?.tasks ?? [];
  // Comment stream only — hide system entries like "Broken into N steps".
  const activity = (activityQuery.data?.activity ?? []).filter(
    (entry) => entry.activityType === "comment"
  );
  const tags = task?.tags ?? [];
  const assignedNames = new Set(tags.map((t) => t.name.toLowerCase()));
  const tagSuggestions = (listTagsQuery.data?.tags ?? [])
    .filter((t) =>
      isNew ? !newTags.includes(t.name.toLowerCase()) : !assignedNames.has(t.name.toLowerCase())
    )
    .slice(0, 8);

  return (
    <div className="tk-modal-scrim" onClick={props.onClose}>
      <div
        className="tk-modal"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="tk-modal__head">
          <div className="tk-modal__headmain">
            <div className="tk-modal__eyebrow">{isNew ? "New task" : "Task details"}</div>
            <input
              className="tk-modal__titlein"
              value={form.title}
              autoFocus
              placeholder="What needs doing?"
              aria-label="Task title"
              onChange={(event) => setForm((f) => ({ ...f, title: event.target.value }))}
            />
          </div>
          <button className="tk-modal__x" onClick={props.onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="tk-modal__body">
          <div className="tk-form">
            {/* Comment stream first — surface activity without scrolling. */}
            {!isNew ? (
              <div className="tk-field tk-field--full">
                <span className="tk-flabel">Activity</span>
                <ActivityLog
                  entries={activity}
                  currentUserLabel={props.currentUserLabel}
                  draft={comment}
                  pending={commentMutation.isPending}
                  onDraft={setComment}
                  onPost={() => {
                    const body = comment.trim();
                    if (body) commentMutation.mutate(body);
                  }}
                />
              </div>
            ) : null}

            <div className="tk-field tk-field--full">
              <span className="tk-flabel">Notes</span>
              <textarea
                className="tk-textarea"
                value={form.description}
                placeholder="Context, links, anything worth remembering…"
                onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
              />
            </div>

            <div className="tk-field tk-field--full">
              <span className="tk-flabel">Assigned to</span>
              <div className="tk-peoplefield">
                <span className="tk-person">
                  <Ava name={props.currentUserLabel} size={20} />
                  <span className="tk-person__nm">
                    {props.currentUserLabel}
                    <span className="tk-person__me"> · you</span>
                  </span>
                </span>
              </div>
            </div>

            <div className="tk-field">
              <span className="tk-flabel">List</span>
              <select
                className="jds-select"
                value={form.listId}
                onChange={(event) => setForm((f) => ({ ...f, listId: event.target.value }))}
              >
                {props.lists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="tk-field">
              <span className="tk-flabel">Priority</span>
              <select
                className="jds-select"
                value={form.priority}
                onChange={(event) => setForm((f) => ({ ...f, priority: event.target.value }))}
              >
                <option value="">No priority</option>
                {PRIORITY_LEVELS.map((level) => (
                  <option key={level.value} value={level.value}>
                    {level.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="tk-field">
              <span className="tk-flabel">Due date</span>
              <input
                type="date"
                className="tk-native"
                value={form.dueAt}
                onChange={(event) => setForm((f) => ({ ...f, dueAt: event.target.value }))}
              />
            </div>
            <div className="tk-field">
              <span className="tk-flabel">Reminder</span>
              <input
                type="date"
                className="tk-native"
                value={form.doAt}
                onChange={(event) => setForm((f) => ({ ...f, doAt: event.target.value }))}
              />
            </div>

            <div className="tk-field tk-field--full">
              <span className="tk-flabel">Effort</span>
              <div className="jds-segmented" role="group" aria-label="Effort">
                {EFFORTS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`jds-segmented__opt ${form.effort === option.value ? "is-active" : ""}`}
                    aria-pressed={form.effort === option.value}
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        effort: f.effort === option.value ? "" : option.value
                      }))
                    }
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="tk-field">
              <span className="tk-flabel">Repeats</span>
              <select
                className="jds-select"
                value={form.repeat}
                onChange={(event) =>
                  setForm((f) => ({ ...f, repeat: event.target.value as Repeat }))
                }
              >
                {REPEATS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            {form.repeat !== "never" ? (
              <div className="tk-field">
                <span className="tk-flabel">Ends</span>
                <input
                  type="date"
                  className="tk-native"
                  value={form.repeatEnd}
                  onChange={(event) => setForm((f) => ({ ...f, repeatEnd: event.target.value }))}
                />
              </div>
            ) : (
              <div className="tk-field" />
            )}

            <div className="tk-field tk-field--full">
              <span className="tk-flabel">Tags</span>
              <div className="tk-tagedit">
                {isNew
                  ? newTags.map((name) => (
                      <span key={name} className="jds-chip">
                        <span
                          style={{ fontFamily: "var(--font-mono)", color: "var(--text-faint)" }}
                        >
                          #
                        </span>
                        {name}
                        <button
                          type="button"
                          className="jds-chip__x"
                          aria-label={`Remove ${name}`}
                          onClick={() => setNewTags((t) => t.filter((x) => x !== name))}
                        >
                          <X size={13} aria-hidden="true" />
                        </button>
                      </span>
                    ))
                  : tags.map((tag) => (
                      <span key={tag.id} className="jds-chip">
                        <span
                          style={{ fontFamily: "var(--font-mono)", color: "var(--text-faint)" }}
                        >
                          #
                        </span>
                        {tag.name}
                        <button
                          type="button"
                          className="jds-chip__x"
                          aria-label={`Remove ${tag.name}`}
                          onClick={() => unassignTagMutation.mutate(tag.id)}
                        >
                          <X size={13} aria-hidden="true" />
                        </button>
                      </span>
                    ))}
                <input
                  value={tagDraft}
                  placeholder={
                    (isNew ? newTags.length : tags.length)
                      ? "Add another…"
                      : "Type a tag and press Enter"
                  }
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === ",") {
                      event.preventDefault();
                      const name = tagDraft.trim().replace(/^#/, "").toLowerCase();
                      if (!name) return;
                      if (isNew) {
                        setNewTags((t) => (t.includes(name) ? t : [...t, name]));
                        setTagDraft("");
                      } else {
                        assignTagMutation.mutate(name);
                      }
                    }
                  }}
                />
              </div>
              {tagSuggestions.length > 0 ? (
                <div className="tk-tagsugg">
                  {tagSuggestions.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      className="tk-tagsugg__btn"
                      onClick={() => {
                        const name = tag.name.toLowerCase();
                        if (isNew) setNewTags((t) => (t.includes(name) ? t : [...t, name]));
                        else assignTagMutation.mutate(tag.name);
                      }}
                    >
                      #{tag.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="tk-field tk-field--full">
              <span className="tk-flabel">Subtasks</span>
              <div className="tk-subs">
                {isNew
                  ? newSubs.map((text, i) => (
                      <div className="tk-sub" key={i}>
                        <span className="tk-sub__box" />
                        <input
                          value={text}
                          placeholder="Subtask"
                          onChange={(event) =>
                            setNewSubs((s) => s.map((v, j) => (j === i ? event.target.value : v)))
                          }
                        />
                        <button
                          type="button"
                          className="tk-sub__rm"
                          aria-label="Remove subtask"
                          onClick={() => setNewSubs((s) => s.filter((_, j) => j !== i))}
                        >
                          <X size={15} aria-hidden="true" />
                        </button>
                      </div>
                    ))
                  : subs.map((sub) => (
                      <div
                        className={`tk-sub ${sub.status === "done" ? "tk-sub--done" : ""}`}
                        key={sub.id}
                      >
                        <span
                          className={`tk-sub__box ${sub.status === "done" ? "is-on" : ""}`}
                          onClick={() =>
                            toggleSubMutation.mutate({
                              id: sub.id,
                              status: sub.status === "done" ? "todo" : "done"
                            })
                          }
                        >
                          {sub.status === "done" ? <Check size={12} aria-hidden="true" /> : null}
                        </span>
                        <input value={sub.title} readOnly />
                      </div>
                    ))}
                {isNew ? (
                  <button
                    type="button"
                    className="tk-sub__add"
                    onClick={() => setNewSubs((s) => [...s, ""])}
                  >
                    <Plus size={15} aria-hidden="true" />
                    Add subtask
                  </button>
                ) : (
                  <div className="tk-subadd">
                    <input
                      value={subDraft}
                      placeholder="Add a subtask and press Enter"
                      onChange={(event) => setSubDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          const text = subDraft.trim();
                          if (text) addSubMutation.mutate(text);
                        }
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="tk-modal__foot">
          {!isNew ? (
            <StatusControl
              status={form.status}
              onChange={(status) => setForm((f) => ({ ...f, status }))}
            />
          ) : null}
          <span className="sp" style={{ flex: 1 }} />
          <button type="button" className="jds-btn jds-btn--quiet" onClick={props.onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="jds-btn jds-btn--primary"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {isNew ? "Add task" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Status as a split button: Complete (toggles done) + a caret for Archive / Reopen. */
function StatusControl(props: {
  readonly status: TaskApiStatus;
  readonly onChange: (status: TaskApiStatus) => void;
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

  const done = props.status === "done";
  const archived = props.status === "archived";
  const mainLabel = done ? "Completed" : archived ? "Archived" : "Complete";
  const MainIcon = done ? Check : archived ? Archive : Circle;
  const mainClass = done ? "is-done" : archived ? "is-archived" : "";

  const items: {
    readonly label: string;
    readonly icon: typeof Circle;
    readonly status: TaskApiStatus;
  }[] = [];
  if (!archived) items.push({ label: "Archive", icon: Archive, status: "archived" });
  if (props.status !== "todo") items.push({ label: "Mark as open", icon: Circle, status: "todo" });

  return (
    <div className="tk-statusctl" ref={ref}>
      <button
        type="button"
        className={`tk-statusctl__main ${mainClass}`}
        onClick={() => props.onChange(done || archived ? "todo" : "done")}
      >
        <MainIcon size={15} aria-hidden="true" />
        {mainLabel}
      </button>
      <button
        type="button"
        className="tk-statusctl__more"
        aria-label="More status options"
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && items.length > 0 ? (
        <div className="tk-statusctl__menu tk-tagmenu">
          {items.map((item) => {
            const Ico = item.icon;
            return (
              <button
                key={item.status}
                type="button"
                className="tk-tagmenu__item"
                onClick={() => {
                  props.onChange(item.status);
                  setOpen(false);
                }}
              >
                <Ico size={14} aria-hidden="true" />
                <span className="nm">{item.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ActivityLog(props: {
  readonly entries: readonly TaskActivityDto[];
  readonly currentUserLabel: string;
  readonly draft: string;
  readonly pending: boolean;
  readonly onDraft: (value: string) => void;
  readonly onPost: () => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="tk-activity">
      {props.entries.length > 0 ? (
        <div className="tk-act-list">
          {props.entries.map((entry) => (
            <div className="tk-act" key={entry.id}>
              <Ava name={props.currentUserLabel} size={28} />
              <div className="tk-act__body">
                <div className="tk-act__head">
                  <span className="tk-act__who">{props.currentUserLabel}</span>
                  <span className="tk-act__when">{relativeTime(entry.createdAt)}</span>
                </div>
                <div className="tk-act__text">{entry.body ?? entry.activityType}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="tk-act-empty">No activity yet. Log progress as you go.</div>
      )}

      <div className="tk-act-composer">
        <textarea
          ref={taRef}
          value={props.draft}
          rows={1}
          placeholder="Add a comment…"
          onChange={(event) => props.onDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              props.onPost();
            }
          }}
        />
        <button
          type="button"
          className="tk-act-send"
          disabled={!props.draft.trim() || props.pending}
          onClick={props.onPost}
          aria-label="Post comment"
        >
          <ArrowUp size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="tk-act-hint">Enter to post · Shift+Enter for a new line</div>
    </div>
  );
}
