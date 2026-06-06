import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NoteApiVisibility } from "@jarv1s/shared";
import { Archive, ArrowLeft, LoaderCircle, Save } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import { getNote, updateNote } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { visibilityLabels } from "./note-format";

interface NoteDetailPageProps {
  readonly activeWorkspaceId: string | null;
}

export function NoteDetailPage(props: NoteDetailPageProps) {
  const { noteId } = useParams<{ readonly noteId: string }>();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<NoteApiVisibility>("private");
  const [archived, setArchived] = useState(false);
  const noteQuery = useQuery({
    enabled: Boolean(noteId),
    queryKey: queryKeys.notes.detail(noteId ?? "", props.activeWorkspaceId),
    queryFn: () => getNote(noteId ?? "", props.activeWorkspaceId)
  });
  const saveMutation = useMutation({
    mutationFn: () => {
      if (!noteId) {
        throw new Error("Note id is missing");
      }
      if (visibility === "workspace" && !props.activeWorkspaceId) {
        throw new Error("Select a workspace first");
      }

      return updateNote(
        noteId,
        {
          title,
          body: body || null,
          visibility,
          workspaceId: visibility === "workspace" ? props.activeWorkspaceId : null,
          archived
        },
        props.activeWorkspaceId
      );
    },
    onSuccess: async () => {
      if (!noteId) {
        return;
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.notes.list(props.activeWorkspaceId) }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.notes.detail(noteId, props.activeWorkspaceId)
        })
      ]);
    }
  });

  useEffect(() => {
    const note = noteQuery.data?.note;

    if (!note) {
      return;
    }

    setTitle(note.title);
    setBody(note.body ?? "");
    setVisibility(note.visibility);
    setArchived(note.archivedAt !== null);
  }, [noteQuery.data?.note]);

  const handleSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    saveMutation.mutate();
  };

  if (noteQuery.isLoading) {
    return <DetailState title="Loading note" loading />;
  }

  if (noteQuery.error) {
    return <DetailState title={noteQuery.error.message} />;
  }

  if (!noteQuery.data?.note) {
    return <DetailState title="Note not found" />;
  }

  return (
    <section className="page-stack" aria-labelledby="note-detail-title">
      <div className="page-heading">
        <div>
          <Link className="back-link" to="/notes">
            <ArrowLeft size={17} aria-hidden="true" />
            Notes
          </Link>
          <h1 id="note-detail-title">Edit Note</h1>
        </div>
      </div>

      <section className="panel" aria-labelledby="note-fields-title">
        <div className="panel-heading">
          <Save size={20} aria-hidden="true" />
          <h2 id="note-fields-title">Fields</h2>
        </div>

        <form className="note-detail-form" onSubmit={handleSave}>
          <label className="span-2">
            Title
            <input
              onChange={(event) => setTitle(event.target.value)}
              required
              type="text"
              value={title}
            />
          </label>

          <label className="span-2">
            Body
            <textarea onChange={(event) => setBody(event.target.value)} rows={10} value={body} />
          </label>

          <label>
            Visibility
            <select
              onChange={(event) => setVisibility(event.target.value as NoteApiVisibility)}
              value={visibility}
            >
              {Object.entries(visibilityLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="checkbox-row">
            <input
              checked={archived}
              onChange={(event) => setArchived(event.target.checked)}
              type="checkbox"
            />
            Archived
          </label>

          {saveMutation.error ? (
            <p className="form-error span-2">{saveMutation.error.message}</p>
          ) : null}

          <button className="primary-button span-2" disabled={saveMutation.isPending} type="submit">
            {saveMutation.isPending ? (
              <LoaderCircle className="spin" size={18} aria-hidden="true" />
            ) : (
              <Save size={18} aria-hidden="true" />
            )}
            Save note
          </button>
        </form>
      </section>
    </section>
  );
}

function DetailState(props: { readonly loading?: boolean; readonly title: string }) {
  return (
    <section className="page-stack">
      <Link className="back-link" to="/notes">
        <ArrowLeft size={17} aria-hidden="true" />
        Notes
      </Link>
      <div className="empty-state">
        {props.loading ? (
          <LoaderCircle className="spin" size={22} aria-hidden="true" />
        ) : (
          <Archive size={22} aria-hidden="true" />
        )}
        <p>{props.title}</p>
      </div>
    </section>
  );
}
