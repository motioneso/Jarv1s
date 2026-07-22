// #1198: Park Press onboarding controls. These collect values only; writes
// remain owned by the assistant confirmation gateway in index.tsx.
import { Eyebrow, Strap } from "../../kit";
import { h, useState, type ReactNodeLike } from "../../runtime";
import { sourceQuery, type BroadSearchSummary, type SourceInfo } from "./model";

export const RESUME_ACCEPT =
  "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.pdf,.docx";
export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

function CheckIcon(): ReactNodeLike {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function FileTextIcon(): ReactNodeLike {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
      <path d="M6 2h8l4 4v16H6zM14 2v5h5M9 13h6M9 17h6" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function ChipToggle(props: {
  readonly on: boolean;
  readonly inferred?: boolean;
  readonly onClick: () => void;
  readonly children?: unknown;
  readonly key?: string;
}): ReactNodeLike {
  return (
    <button
      type="button"
      className={`jds-chip jsm-chip${props.on ? " is-active" : ""}${props.inferred && !props.on ? " is-inferred" : ""}`}
      aria-pressed={props.on}
      onClick={props.onClick}
    >
      {props.on ? <CheckIcon /> : null}
      {props.children}
      {props.inferred ? <span className="jds-eyebrow">inferred</span> : null}
    </button>
  );
}

export function AddInput(props: {
  readonly placeholder: string;
  readonly helper?: string;
  readonly onAdd: (value: string) => void;
}): ReactNodeLike {
  const [value, setValue] = useState("");
  const add = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    props.onAdd(trimmed);
    setValue("");
  };
  return (
    <span className="jsm-add-input">
      <span>
        <input
          value={value}
          aria-label={props.placeholder}
          placeholder={props.placeholder}
          onChange={(event: { currentTarget: { value: string } }) =>
            setValue(event.currentTarget.value)
          }
          onKeyDown={(event: { key: string; preventDefault(): void }) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            add();
          }}
        />
        {props.helper ? <small>{props.helper}</small> : null}
      </span>
      <button
        type="button"
        className="jds-btn jds-btn--secondary jds-btn--sm"
        onClick={add}
        aria-label={`Add ${props.placeholder}`}
      >
        +
      </button>
    </span>
  );
}

export function MultiControl(props: {
  readonly key?: string;
  readonly options: readonly string[];
  readonly initial?: readonly string[];
  readonly inferred?: readonly string[];
  readonly addPlaceholder?: string;
  readonly cta: string;
  readonly skip?: string;
  readonly min?: number;
  readonly onSubmit: (values: readonly string[]) => void;
}): ReactNodeLike {
  const [selected, setSelected] = useState<readonly string[]>(props.initial ?? []);
  const [extra, setExtra] = useState<readonly string[]>([]);
  const options = [...props.options, ...extra];
  const toggle = (value: string) =>
    setSelected((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    );
  return (
    <div className="jsm-control-stack">
      <div className="jsm-chip-row">
        {options.map((option) => (
          <ChipToggle
            key={option}
            on={selected.includes(option)}
            inferred={props.inferred?.includes(option)}
            onClick={() => toggle(option)}
          >
            {option}
          </ChipToggle>
        ))}
        {props.addPlaceholder ? (
          <AddInput
            placeholder={props.addPlaceholder}
            onAdd={(value) => {
              if (!options.includes(value)) setExtra((current) => [...current, value]);
              if (!selected.includes(value)) setSelected((current) => [...current, value]);
            }}
          />
        ) : null}
      </div>
      <div className="jsm-button-row">
        <button
          type="button"
          className="jds-btn jds-btn--primary jds-btn--sm"
          disabled={selected.length < (props.min ?? 0)}
          onClick={() => props.onSubmit(selected)}
        >
          {props.cta}
        </button>
        {props.skip ? (
          <button
            type="button"
            className="jds-btn jds-btn--ghost jds-btn--sm"
            onClick={() => props.onSubmit([])}
          >
            {props.skip}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function ResumeDropzone(props: {
  readonly showPaste?: boolean;
  readonly error?: string | null;
  readonly onFile: (file: File) => void;
  readonly onPaste: (text: string) => void;
}): ReactNodeLike {
  const [pasted, setPasted] = useState("");
  return (
    <div className="jsm-control-stack">
      <label className="jsm-dropzone">
        <input
          className="jsm-visually-hidden"
          type="file"
          accept={RESUME_ACCEPT}
          onChange={(event: { currentTarget: { files: FileList | null } }) => {
            const file = event.currentTarget.files?.[0];
            if (file) props.onFile(file);
          }}
        />
        <span className="jsm-file-glyph">
          <FileTextIcon />
        </span>
        <strong>Drop your resume, or browse</strong>
        <span className="jds-eyebrow">PDF · DOCX · up to 5 MB</span>
      </label>
      {props.error ? (
        <p className="jsm-control-error" role="alert">
          {props.error}
        </p>
      ) : null}
      {props.showPaste ? (
        <div className="jsm-paste-fallback">
          <label htmlFor="jsm-resume-paste">Paste resume text instead</label>
          <textarea
            id="jsm-resume-paste"
            value={pasted}
            rows={6}
            onChange={(event: { currentTarget: { value: string } }) =>
              setPasted(event.currentTarget.value)
            }
          />
          <button
            type="button"
            className="jds-btn jds-btn--primary jds-btn--sm"
            disabled={!pasted.trim()}
            onClick={() => props.onPaste(pasted)}
          >
            Use pasted resume
          </button>
        </div>
      ) : null}
    </div>
  );
}

const SOURCE_IDS = new Set(["greenhouse", "lever", "ashby"]);

export interface SourcesSelection {
  readonly boards: readonly {
    readonly adapterId: string;
    readonly query: { readonly board: string } | { readonly url: string };
  }[];
  readonly dueTime: string;
}

export function SourcesControl(props: {
  readonly sources: readonly SourceInfo[];
  readonly initialRunTime?: string;
  readonly onSubmit: (selection: SourcesSelection) => void;
}): ReactNodeLike {
  const sources = props.sources.filter(
    (source) => source.enabled && SOURCE_IDS.has(source.adapterId)
  );
  const [enabled, setEnabled] = useState<Readonly<Record<string, boolean>>>(
    Object.fromEntries(sources.map((source) => [source.adapterId, true]))
  );
  const [configs, setConfigs] = useState<Readonly<Record<string, string>>>({});
  const [dueTime, setDueTime] = useState(props.initialRunTime ?? "07:00");
  const active = sources.filter((source) => enabled[source.adapterId]);
  const ready =
    active.length > 0 && active.every((source) => sourceQuery(configs[source.adapterId] ?? ""));
  return (
    <div className="jsm-control-stack">
      <div className="jsm-source-list">
        {sources.map((source) => (
          <div className="jds-card jsm-source-control" key={source.adapterId}>
            <label>
              <span>
                <strong>{source.displayName}</strong>
                <small>{source.configHint}</small>
              </span>
              <input
                type="checkbox"
                checked={Boolean(enabled[source.adapterId])}
                onChange={() =>
                  setEnabled((current) => ({
                    ...current,
                    [source.adapterId]: !current[source.adapterId]
                  }))
                }
              />
            </label>
            {enabled[source.adapterId] ? (
              <input
                aria-label={`${source.displayName} board token or URL`}
                value={configs[source.adapterId] ?? ""}
                placeholder={source.configHint}
                onChange={(event: { currentTarget: { value: string } }) => {
                  // event.currentTarget is nulled once dispatch completes, so it must be
                  // read synchronously here, not inside the deferred setState updater below.
                  const value = event.currentTarget.value;
                  setConfigs((current) => ({ ...current, [source.adapterId]: value }));
                }}
              />
            ) : null}
          </div>
        ))}
      </div>
      <div className="jsm-run-time">
        <span className="jds-eyebrow">Daily run</span>
        {["06:00", "07:00", "08:00"].map((time) => (
          <ChipToggle key={time} on={dueTime === time} onClick={() => setDueTime(time)}>
            {time}
          </ChipToggle>
        ))}
      </div>
      <button
        type="button"
        className="jds-btn jds-btn--primary jds-btn--sm"
        disabled={!ready}
        onClick={() =>
          props.onSubmit({
            boards: active.flatMap((source) => {
              const query = sourceQuery(configs[source.adapterId] ?? "");
              return query ? [{ adapterId: source.adapterId, query }] : [];
            }),
            dueTime
          })
        }
      >
        {`Watch these ${active.length} boards`}
      </button>
    </div>
  );
}

// JS-10 (#1229): broad discovery is the PRIMARY sources_schedule control —
// derived from the approved profile, no credential input (freehire is
// keyless). SourcesControl (board watches) is demoted below as an optional,
// collapsed add-on rather than replaced; its own payload shape is untouched.
function summarizeBroad(summary: BroadSearchSummary): string {
  const titles = summary.titles.length ? summary.titles.join(", ") : "your target titles";
  const where = summary.locations.length ? `, in ${summary.locations.join(", ")}` : "";
  const remote = summary.remote ? " (remote included)" : "";
  return `I'll search ${titles} across every company Freehire indexes${where}${remote}.`;
}

export function BroadSearchCard(props: {
  readonly summary: BroadSearchSummary;
  readonly dueTime: string;
  readonly onStart: () => void;
}): ReactNodeLike {
  return (
    <section className="jds-card jsm-broad-card">
      <Eyebrow tone="gold">Broad search · Freehire</Eyebrow>
      <p>{summarizeBroad(props.summary)}</p>
      <p className="jds-eyebrow jsm-text-accent">
        {`No credentials needed · daily run ${props.dueTime} · up to ${props.summary.maxResults} matches`}
      </p>
      <div className="jsm-button-row">
        <button type="button" className="jds-btn jds-btn--primary" onClick={props.onStart}>
          Start my search
        </button>
      </div>
    </section>
  );
}

export function SourcesStep(props: {
  readonly broad: BroadSearchSummary;
  readonly sources: readonly SourceInfo[];
  readonly initialRunTime?: string;
  readonly onStartBroad: (dueTime: string) => void;
  readonly onAddBoards: (selection: SourcesSelection) => void;
}): ReactNodeLike {
  const [expanded, setExpanded] = useState(false);
  const dueTime = props.initialRunTime ?? "07:00";
  return (
    <div className="jsm-control-stack">
      <BroadSearchCard
        summary={props.broad}
        dueTime={dueTime}
        onStart={() => props.onStartBroad(dueTime)}
      />
      <button
        type="button"
        className="jds-btn jds-btn--ghost jds-btn--sm"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? "Hide company boards" : "Also watch specific company boards (optional)"}
      </button>
      {expanded ? (
        <SourcesControl sources={props.sources} initialRunTime={dueTime} onSubmit={props.onAddBoards} />
      ) : null}
    </div>
  );
}

export function CritiqueCard(props: {
  readonly summary: string;
  readonly strengths: readonly string[];
  readonly cautions: readonly string[];
}): ReactNodeLike {
  return (
    <section className="jsm-critique-card">
      <Eyebrow tone="gold">Read your resume · draft</Eyebrow>
      <p>{props.summary}</p>
      <div className="jsm-critique-grid">
        <div>
          <span className="jds-eyebrow jsm-text-accent">Strengths I’ll cite</span>
          <ul>
            {props.strengths.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <span className="jds-eyebrow jsm-text-gold">I’d source before citing</span>
          <ul>
            {props.cautions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export interface ProfileAsideValues {
  readonly resume?: string;
  readonly titles?: string;
  readonly comp?: string;
  readonly workMode?: string;
  readonly locations?: string;
  readonly dealbreakers?: string;
  readonly sources?: string;
  readonly runTime?: string;
}

const ASIDE_ROWS: readonly [keyof ProfileAsideValues, string][] = [
  ["resume", "Resume"],
  ["titles", "Titles"],
  ["comp", "Comp floor"],
  ["workMode", "Work mode"],
  ["locations", "Locations"],
  ["dealbreakers", "Dealbreakers"],
  ["sources", "Sources"],
  ["runTime", "Daily run"]
];

export function ProfileAside(props: { readonly values: ProfileAsideValues }): ReactNodeLike {
  const count = ASIDE_ROWS.filter(([key]) => Boolean(props.values[key])).length;
  return (
    <aside className="jsm-profile-aside">
      <div className="jsm-row">
        <span className="jds-eyebrow">Building your profile</span>
        <span className="jds-eyebrow jsm-text-gold">{`${count}/8`}</span>
      </div>
      <Strap />
      <div className="jsm-profile-aside__rows">
        {ASIDE_ROWS.map(([key, label]) => {
          const value = props.values[key];
          return (
            <div className="jsm-profile-aside__row" key={key}>
              <span className={`jsm-aside-status${value ? " is-set" : ""}`}>
                {value ? <CheckIcon /> : null}
              </span>
              <span>
                <span className="jds-eyebrow">{label}</span>
                <strong>{value ?? "Not yet"}</strong>
              </span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export function Summary(props: {
  readonly runTime: string;
  readonly onContinue: () => void;
  readonly onReset: () => void;
}): ReactNodeLike {
  return (
    <section className="jds-card jsm-summary">
      <p className="jds-eyebrow jsm-text-accent">{`Monitoring on · first run ${props.runTime}`}</p>
      <div className="jsm-button-row">
        <button type="button" className="jds-btn jds-btn--primary" onClick={props.onContinue}>
          Go to Job Search
        </button>
        <button type="button" className="jds-btn jds-btn--ghost" onClick={props.onReset}>
          Start over
        </button>
      </div>
    </section>
  );
}
