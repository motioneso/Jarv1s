import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronRight,
  Folder,
  FolderCheck,
  FolderOpen,
  HardDrive,
  Terminal
} from "lucide-react";
import { useState } from "react";

import { getNotesSourceDirectories } from "../api/notes-client";
import { queryKeys } from "../api/query-keys";
import { readError } from "./settings-types";

export function VaultChooser(props: {
  readonly current: string;
  readonly onCancel: () => void;
  readonly onChoose: (path: string) => void;
}) {
  const [path, setPath] = useState<string | null>(props.current || null);
  const [typed, setTyped] = useState(props.current);
  const rootsQuery = useQuery({
    queryKey: queryKeys.settings.notesSourceDirectories(null),
    queryFn: () => getNotesSourceDirectories(null),
    retry: false
  });
  const directoriesQuery = useQuery({
    queryKey: queryKeys.settings.notesSourceDirectories(path),
    queryFn: () => getNotesSourceDirectories(path),
    retry: false,
    enabled: path !== null
  });

  const roots = rootsQuery.data?.directories ?? [];
  const directories =
    (path ? directoriesQuery.data?.directories : rootsQuery.data?.directories) ?? [];
  const error = rootsQuery.error ?? (path ? directoriesQuery.error : null);
  const loading = rootsQuery.isLoading || (path !== null && directoriesQuery.isLoading);

  const go = (nextPath: string | null) => {
    setPath(nextPath);
    setTyped(nextPath ?? "");
  };
  const submitTyped = () => go(typed.trim().replace(/\/$/, "") || null);

  return (
    <div className="gflow">
      <button type="button" className="gflow__back" onClick={props.onCancel}>
        <ArrowLeft size={15} aria-hidden="true" />
        Data sources
      </button>
      <div className="gflow__intro">
        <span className="msub__mark">
          <HardDrive size={21} aria-hidden="true" />
        </span>
        <div className="gflow__introtx">
          <div className="gflow__title">Choose a notes folder</div>
          <div className="gflow__sub">Browsing mapped server folders</div>
        </div>
      </div>

      <div className="vbrowse">
        <div className="vbrowse__roots">
          {roots.map((root) => (
            <button
              key={root.path}
              type="button"
              className={`vroot${path === root.path ? " is-active" : ""}`}
              onClick={() => go(root.path)}
            >
              <Folder size={15} aria-hidden="true" />
              <span className="vroot__main">
                <span className="vroot__label">{root.name}</span>
                <span className="vroot__path">{root.path}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="vbrowse__panel">
          <div className="vcrumb">
            <button
              type="button"
              className="vcrumb__seg"
              disabled={path === null}
              onClick={() => go(null)}
            >
              Mapped folders
            </button>
            {path ? (
              <>
                <ChevronRight size={13} aria-hidden="true" />
                <span className="vcrumb__seg">{path}</span>
              </>
            ) : null}
          </div>

          <div className="vlist">
            {loading ? (
              <div className="vlist__empty">
                <FolderOpen size={16} aria-hidden="true" />
                Loading folders…
              </div>
            ) : null}
            {error ? (
              <div className="vlist__empty">
                <FolderOpen size={16} aria-hidden="true" />
                {readError(error)}
              </div>
            ) : null}
            {!loading && !error && directories.length === 0 ? (
              <div className="vlist__empty">
                <FolderOpen size={16} aria-hidden="true" />
                This folder has no subfolders.
              </div>
            ) : null}
            {!loading && !error
              ? directories.map((directory) => (
                  <button
                    key={directory.path}
                    type="button"
                    className="vitem"
                    onClick={() => go(directory.path)}
                  >
                    <Folder size={16} aria-hidden="true" />
                    <span className="vitem__name">{directory.name}</span>
                    <ChevronRight size={15} aria-hidden="true" />
                  </button>
                ))
              : null}
          </div>

          <div className="vtyped">
            <span className="vtyped__lbl">Or type a path on the server</span>
            <div className="vtyped__row">
              <span className="ic">
                <Terminal size={14} aria-hidden="true" />
              </span>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                spellCheck={false}
                aria-label="Type a path on the server"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitTyped();
                  }
                }}
                placeholder="/data/external-notes"
              />
              <button
                type="button"
                className="jds-btn jds-btn--quiet jds-btn--sm"
                onClick={submitTyped}
              >
                Go
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="vselect">
        <div className="vselect__main">
          <div className="vselect__lbl">Selected folder</div>
          <div className="vselect__path">
            <FolderCheck size={15} aria-hidden="true" />
            {path ?? "No folder selected"}
          </div>
          <div className="vselect__meta">Jarvis reads this folder and its text files.</div>
        </div>
        <div className="vselect__acts">
          <button
            type="button"
            className="jds-btn jds-btn--quiet jds-btn--sm"
            onClick={props.onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="jds-btn jds-btn--primary jds-btn--sm"
            disabled={!path || loading || Boolean(error)}
            onClick={() => (path ? props.onChoose(path) : undefined)}
          >
            <span className="jds-btn__icon">
              <FolderCheck size={15} />
            </span>
            Use this folder
          </button>
        </div>
      </div>
    </div>
  );
}
