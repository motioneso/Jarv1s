import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NoteApiVisibility, NoteDto } from "@jarv1s/shared";
import { Archive, FileText, LoaderCircle, Plus, Search } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Link } from "react-router";

import { createNote, listNotes, updateNote } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { formatNoteDate, sortNotes } from "./note-format";

interface NotesPageProps {
  readonly activeWorkspaceId: string | null;
}

const noteFilters = ["active", "archived", "all"] as const;

type NoteFilter = (typeof noteFilters)[number];

export function NotesPage(props: NotesPageProps) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<NoteFilter>("active");
  const [search, setSearch] = useState("");
  const notesQuery = useQuery({
    queryKey: queryKeys.notes.list(props.activeWorkspaceId),
    queryFn: () => listNotes(props.activeWorkspaceId)
  });
  const archiveMutation = useMutation({
    mutationFn: (noteId: string) => updateNote(noteId, { archived: true }, props.activeWorkspaceId),
    onSuccess: async (_, noteId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.notes.list(props.activeWorkspaceId) }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.notes.detail(noteId, props.activeWorkspaceId)
        })
      ]);
    }
  });
  const notes = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return sortNotes(notesQuery.data?.notes ?? []).filter((note) => {
      const archived = note.archivedAt !== null;
      const matchesFilter = filter === "all" || (filter === "archived" ? archived : !archived);
      const matchesSearch =
        !normalizedSearch ||
        note.title.toLowerCase().includes(normalizedSearch) ||
        (note.body?.toLowerCase().includes(normalizedSearch) ?? false);

      return matchesFilter && matchesSearch;
    });
  }, [filter, notesQuery.data?.notes, search]);
  const counts = useMemo(() => readNoteCounts(notesQuery.data?.notes ?? []), [notesQuery.data]);

  return (
    <section className="page-stack" aria-labelledby="notes-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Notes</p>
          <h1 id="notes-title">Notes</h1>
        </div>
      </div>

      <CreateNotePanel activeWorkspaceId={props.activeWorkspaceId} />

      <section className="task-toolbar" aria-label="Note filters">
        <div className="segmented-control wide" aria-label="Archive filter">
          {noteFilters.map((status) => (
            <button
              className={filter === status ? "active" : ""}
              key={status}
              type="button"
              onClick={() => setFilter(status)}
            >
              {status[0]?.toUpperCase()}
              {status.slice(1)}
              <span>{counts[status]}</span>
            </button>
          ))}
        </div>

        <label className="search-box">
          <Search size={18} aria-hidden="true" />
          <input
            aria-label="Search notes"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search notes"
            type="search"
            value={search}
          />
        </label>
      </section>

      <section className="task-list" aria-live="polite">
        {notesQuery.isLoading ? (
          <EmptyState loading title="Loading notes" />
        ) : notesQuery.error ? (
          <EmptyState title={notesQuery.error.message} />
        ) : notes.length === 0 ? (
          <EmptyState title="No notes" />
        ) : (
          notes.map((note) => (
            <NoteRow
              isUpdating={archiveMutation.isPending}
              key={note.id}
              note={note}
              onArchive={() => archiveMutation.mutate(note.id)}
            />
          ))
        )}
      </section>
    </section>
  );
}

function CreateNotePanel(props: { readonly activeWorkspaceId: string | null }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<NoteApiVisibility>("private");
  const [formError, setFormError] = useState<string | null>(null);
  const createMutation = useMutation({
    mutationFn: () => {
      if (visibility === "workspace" && !props.activeWorkspaceId) {
        throw new Error("Select a workspace first");
      }

      return createNote(
        {
          title,
          body: body || null,
          visibility,
          workspaceId: visibility === "workspace" ? props.activeWorkspaceId : null
        },
        props.activeWorkspaceId
      );
    },
    onSuccess: async () => {
      setTitle("");
      setBody("");
      setFormError(null);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.notes.list(props.activeWorkspaceId)
      });
    },
    onError: (error) => setFormError(error.message)
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    createMutation.mutate();
  };

  return (
    <section className="panel" aria-labelledby="new-note-title">
      <div className="panel-heading">
        <FileText size={20} aria-hidden="true" />
        <h2 id="new-note-title">New Note</h2>
      </div>

      <form className="note-create-form" onSubmit={handleSubmit}>
        <label className="span-2">
          Title
          <input
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Note title"
            required
            type="text"
            value={title}
          />
        </label>

        <label className="span-2">
          Body
          <textarea
            onChange={(event) => setBody(event.target.value)}
            placeholder="Write a note"
            rows={4}
            value={body}
          />
        </label>

        <div className="segmented-control span-2" aria-label="Note visibility">
          <button
            className={visibility === "private" ? "active" : ""}
            type="button"
            onClick={() => setVisibility("private")}
          >
            Private
          </button>
          <button
            className={visibility === "workspace" ? "active" : ""}
            type="button"
            onClick={() => setVisibility("workspace")}
          >
            Workspace
          </button>
        </div>

        {formError ? <p className="form-error span-2">{formError}</p> : null}

        <button className="primary-button span-2" disabled={createMutation.isPending} type="submit">
          {createMutation.isPending ? (
            <LoaderCircle className="spin" size={18} aria-hidden="true" />
          ) : (
            <Plus size={18} aria-hidden="true" />
          )}
          Add note
        </button>
      </form>
    </section>
  );
}

function NoteRow(props: {
  readonly isUpdating: boolean;
  readonly note: NoteDto;
  readonly onArchive: () => void;
}) {
  return (
    <article className={`task-row ${props.note.archivedAt ? "done" : ""}`}>
      <div className="task-status-icon" aria-hidden="true">
        <FileText size={22} />
      </div>
      <div className="task-row-main">
        <Link className="task-title-link" to={`/notes/${props.note.id}`}>
          {props.note.title}
        </Link>
        {props.note.body ? <p>{props.note.body}</p> : null}
        <div className="task-meta">
          <span>{props.note.archivedAt ? "Archived" : "Active"}</span>
          <span>{props.note.visibility}</span>
          <span>{formatNoteDate(props.note.updatedAt)}</span>
        </div>
      </div>
      <div className="task-row-actions">
        <button
          aria-label={`Archive ${props.note.title}`}
          className="icon-button"
          disabled={props.isUpdating || props.note.archivedAt !== null}
          title="Archive"
          type="button"
          onClick={props.onArchive}
        >
          <Archive size={18} aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

function EmptyState(props: { readonly loading?: boolean; readonly title: string }) {
  return (
    <div className="empty-state">
      {props.loading ? (
        <LoaderCircle className="spin" size={22} aria-hidden="true" />
      ) : (
        <FileText size={22} aria-hidden="true" />
      )}
      <p>{props.title}</p>
    </div>
  );
}

function readNoteCounts(notes: readonly NoteDto[]): Record<NoteFilter, number> {
  const archived = notes.filter((note) => note.archivedAt !== null).length;

  return {
    active: notes.length - archived,
    archived,
    all: notes.length
  };
}
