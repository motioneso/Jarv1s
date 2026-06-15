import {
  ArrowLeft,
  ChevronRight,
  FileText,
  Folder,
  FolderCheck,
  FolderCog,
  FolderLock,
  FolderOpen,
  HardDrive,
  Pencil,
  ShieldCheck,
  Terminal
} from "lucide-react";
import { Fragment, useState } from "react";

import { useFeedback } from "./settings-feedback";
import { SERVER_FS, type ServerRoot } from "./settings-sample-data";
import { NotWired } from "./settings-ui";

/* Server-side path chooser. On a LAN/Docker app there is no OS file picker — the
   user browses the HOST filesystem the container can reach, or types a path.
   Read-only mounts are honoured and surfaced.
   BACKEND-TODO: host-filesystem listing API (reachable mounts + dir contents) and
   read-only mount enforcement. Today browses the SERVER_FS sample tree. */
export function VaultChooser(props: {
  readonly current: string;
  readonly onCancel: () => void;
  readonly onChoose: (path: string) => void;
}) {
  const { toast } = useFeedback();
  const fs = SERVER_FS;
  const startRoot =
    fs.roots.find((r) => props.current && props.current.indexOf(r.name) === 0) ?? fs.roots[0];
  const [path, setPath] = useState(props.current || startRoot?.name || "");
  const [typed, setTyped] = useState(props.current || startRoot?.name || "");

  const rootOf = (p: string): ServerRoot | null =>
    fs.roots.find((r) => p.indexOf(r.name) === 0) ?? null;
  const root = rootOf(path);
  const children = fs.tree[path] ?? [];
  const dirs = children.filter((c) => c.type === "dir");
  const files = children.filter((c) => c.type === "file");
  const mdHere = children.reduce((n, c) => n + (c.mdCount ?? 0), 0);

  const go = (p: string) => {
    setPath(p);
    setTyped(p);
  };
  const crumbs = path.split("/").filter(Boolean);
  const crumbPath = (i: number) => "/" + crumbs.slice(0, i + 1).join("/");
  const writable = root ? root.writable : true;

  const submitTyped = () => {
    const t = typed.replace(/\/$/, "");
    if (fs.tree[t]) go(t);
    else toast("No such folder on the server", { tone: "drift" });
  };

  if (fs.roots.length === 0) {
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
            <div className="gflow__sub">Browsing this server — not your computer</div>
          </div>
        </div>
        <NotWired>
          The server filesystem browser isn't available yet — there's no host-listing API, so
          there's nothing real to browse.
        </NotWired>
        <div className="vselect">
          <div className="vselect__main">
            <div className="vselect__lbl">Selected folder</div>
            <div className="vselect__meta">
              No folder can be chosen until the listing API exists.
            </div>
          </div>
          <div className="vselect__acts">
            <button
              type="button"
              className="jds-btn jds-btn--quiet jds-btn--sm"
              onClick={props.onCancel}
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

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
          <div className="gflow__sub">Browsing this server — not your computer</div>
        </div>
      </div>

      <NotWired>
        This is a sample filesystem, not the real server. No host listing API yet.
      </NotWired>

      <div className="vbrowse">
        <div className="vbrowse__roots">
          {fs.roots.map((r) => (
            <button
              key={r.name}
              type="button"
              className={`vroot${root && root.name === r.name ? " is-active" : ""}`}
              onClick={() => go(r.name)}
            >
              {r.writable ? (
                <FolderCog size={15} aria-hidden="true" />
              ) : (
                <FolderLock size={15} aria-hidden="true" />
              )}
              <span className="vroot__main">
                <span className="vroot__label">{r.label}</span>
                <span className="vroot__path">{r.name}</span>
              </span>
              {!r.writable ? <span className="vroot__ro">RO</span> : null}
            </button>
          ))}
        </div>

        <div className="vbrowse__panel">
          <div className="vcrumb">
            {crumbs.map((c, i) => (
              <Fragment key={i}>
                {i > 0 ? <ChevronRight size={13} aria-hidden="true" /> : null}
                <button
                  type="button"
                  className="vcrumb__seg"
                  disabled={i === crumbs.length - 1}
                  onClick={() => go(crumbPath(i))}
                >
                  {c}
                </button>
              </Fragment>
            ))}
          </div>

          <div className="vlist">
            {dirs.length === 0 && files.length === 0 ? (
              <div className="vlist__empty">
                <FolderOpen size={16} aria-hidden="true" />
                This folder has no subfolders.
              </div>
            ) : null}
            {dirs.map((d) => (
              <button
                key={d.name}
                type="button"
                className="vitem"
                onClick={() => go(`${path}/${d.name}`)}
              >
                <Folder size={16} aria-hidden="true" />
                <span className="vitem__name">{d.name}</span>
                {d.mdCount ? <span className="vitem__count">{d.mdCount} notes</span> : null}
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            ))}
            {files.map((f) => (
              <div key={f.name} className="vitem vitem--file">
                <FileText size={16} aria-hidden="true" />
                <span className="vitem__name">{f.name}</span>
              </div>
            ))}
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
                placeholder="/srv/jarvis/vault/notes"
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
            {path}
          </div>
          <div className="vselect__meta">
            {mdHere ? `${mdHere} notes in this tree · ` : ""}
            {writable ? (
              <span className="vselect__rw">
                <Pencil size={12} aria-hidden="true" />
                Writable mount
              </span>
            ) : (
              <span className="vselect__ro">
                <ShieldCheck size={12} aria-hidden="true" />
                Read-only — Jarvis can never modify these files
              </span>
            )}
          </div>
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
            onClick={() => props.onChoose(path)}
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
