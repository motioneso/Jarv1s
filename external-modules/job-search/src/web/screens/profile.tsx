// external-modules/job-search/src/web/screens/profile.tsx
// K4/K6 (2026-07-28 keyline-restructure plan): "what this search knows about you" — the résumé
// on file, the criteria it read out of it plus whatever chat has added since, and how much the
// morning briefing says about each new match.
//
// Redrawn (2026-07-28, mockup-alignment pass) against the Claude Design mockup
// (docs/superpowers/specs/job-search-mockup/JobsProfile.jsx): a hero header over a two-column
// split (résumé + briefing-detail on the left, what it's looking for on the right), closed by an
// ink rule. Same two translations as overview.tsx: mono labels → sans + tabular-nums (already
// true of every host class below), and every mockup `var(--token)` → a `jds-*` host class — this
// screen's own layout lives in styles-screens.css, which carries zero design tokens.
//
// Résumé upload/replace (Ben's ask, 2026-07-29): the read side and the write UI both moved to
// their own file, ./resume-editor.tsx — see that file's header for the write flow, and
// ./resume-save.ts for the upload-then-enqueue transport (task #108) it calls.
//
// What the mockup draws that this pass does NOT build, and why:
//   - The mockup's résumé card shows a filename, a revision hash, and a list of "confirmed
//     claims" pulled out of the résumé text. None of that exists on job-search.resume.get's wire
//     shape (`{resume: {version, content, updatedAt} | null}`) — there is no filename, no hash,
//     and no per-claim extraction anywhere in this module. Ben's own prior ruling on this module
//     ("fabricated résumé filenames/rev-hashes/confirmed claims... scrap it") is exactly this
//     case; ResumeSection (resume-editor.tsx) reports only what the wire actually returns: on
//     file, version, saved-on date, and length.
//   - The mockup's "latest critique" panel (an AI critique of the résumé) has no backing tool or
//     queue anywhere in this module's manifest — nothing to read, so nothing rendered.
//   - The mockup's "Work mode" field (remote/hybrid/onsite preference framed as a lifestyle
//     choice) doesn't exist on SearchCriteria; the closest real field is `criteria.remote`, kept
//     below as "Remote" with its real four values (required/preferred/no-preference/onsite-ok).
import { h, useEffect, useRef, useState, type ReactNodeLike } from "../runtime";
import { invokeTool, runQueue } from "../api";
import type { Profile } from "../use-profiles";
import type { BriefingDetail } from "../../domain/store-port.js";
import type { SearchCriteria } from "../../domain/records.js";
import { FieldPair, SectionHead } from "../keyline";
import { RESUME_GET_TOOL, ResumeSection, fetchResume, type ResumeState } from "./resume-editor";

export { RESUME_GET_TOOL };
export const PROFILE_GET_TOOL = "job-search.profile.get";
export const PROFILE_SET_BRIEFING_DETAIL_QUEUE = "job-search.profile-set-briefing-detail";
export const CRITERIA_SET_QUEUE = "job-search.criteria-set";
export const PROFILE_RENAME_QUEUE = "job-search.profile-rename";

// -------------------------------------------------------------------------------------------
// Search profile (context summary + criteria)
// -------------------------------------------------------------------------------------------
type CriteriaState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; criteria: SearchCriteria; contextSummary: string | null };

async function fetchCriteria(
  profileId: string
): Promise<{ criteria: SearchCriteria; contextSummary: string | null }> {
  const result = (await invokeTool(PROFILE_GET_TOOL, { profileId })) as {
    criteria?: SearchCriteria;
    contextSummary?: unknown;
  } | null;
  if (result?.criteria == null) {
    throw new Error("profile.get returned no criteria");
  }
  return {
    criteria: result.criteria,
    contextSummary: typeof result.contextSummary === "string" ? result.contextSummary : null
  };
}

const CONTEXT_SUMMARY_RENDER_CAP = 320;

function truncateContextSummary(summary: string): string {
  if (summary.length <= CONTEXT_SUMMARY_RENDER_CAP) return summary;
  return `${summary.slice(0, CONTEXT_SUMMARY_RENDER_CAP).trimEnd()}…`;
}

function ContextSummarySection(props: { state: CriteriaState }): ReactNodeLike {
  const { state } = props;
  if (state.status !== "ready" || state.contextSummary === null) return null;
  const trimmed = state.contextSummary.trim();
  if (trimmed.length === 0) return null;
  return (
    <section className="jsm-settings__group">
      <SectionHead label="What I understand you’re after" />
      <p className="jds-hint jsm-summary">{truncateContextSummary(trimmed)}</p>
    </section>
  );
}

const REMOTE_LABELS: Record<SearchCriteria["remote"], string> = {
  required: "Remote required",
  preferred: "Remote preferred",
  "no-preference": "No preference",
  "onsite-ok": "Onsite OK"
};

function ChipGroup(props: {
  items: string[];
  emptyLabel: string;
  onRemove?: (item: string) => void;
}): ReactNodeLike {
  if (props.items.length === 0) {
    return <p className="jds-hint">{props.emptyLabel}</p>;
  }
  return (
    <div className="jsm-chips">
      {props.items.map((item, index) =>
        props.onRemove ? (
          <button
            key={`${item}-${index}`}
            type="button"
            className="jds-chip jds-chip--criteria"
            aria-label={`Remove ${item}`}
            onClick={() => props.onRemove?.(item)}
          >
            {item}
            <span className="jds-chip__x" aria-hidden="true">
              ×
            </span>
          </button>
        ) : (
          <span key={`${item}-${index}`} className="jds-badge jds-badge--pill jds-badge--neutral">
            {item}
          </span>
        )
      )}
    </div>
  );
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function PayFloorControl(props: {
  cents: number | null;
  saving: boolean;
  onSave(cents: number | null): void;
}): ReactNodeLike {
  const [draft, setDraft] = useState(
    props.cents === null ? "" : String(Math.trunc(props.cents / 100))
  );
  useEffect(() => {
    setDraft(props.cents === null ? "" : String(Math.trunc(props.cents / 100)));
  }, [props.cents]);

  function save(): void {
    const dollars = draft.trim() === "" ? null : Number(draft);
    if (dollars !== null && (!Number.isFinite(dollars) || dollars < 0)) return;
    const cents = dollars === null ? null : dollars * 100;
    if (cents !== props.cents) props.onSave(cents);
  }

  return (
    <form
      onSubmit={(event: { preventDefault(): void }) => {
        event.preventDefault();
        save();
      }}
    >
      <input
        className="jds-input jsm-pay-floor-input"
        aria-label="Pay floor"
        type="number"
        min="0"
        step="1000"
        value={draft}
        disabled={props.saving}
        onChange={(event: { target: { value: string } }) => setDraft(event.target.value)}
        onBlur={save}
      />
    </form>
  );
}

const LIST_FIELDS = [
  ["titles", "Titles"],
  ["seniority", "Seniority"],
  ["locations", "Locations"],
  ["mustHave", "Must have"],
  ["niceToHave", "Nice to have"],
  ["dealbreakers", "Dealbreakers"],
  ["excludeCompanies", "Excluded companies"]
] as const;

function CriteriaEditor(props: {
  criteria: SearchCriteria;
  saving: boolean;
  onCancel(): void;
  onSave(criteria: SearchCriteria): void;
}): ReactNodeLike {
  const [draft, setDraft] = useState(() => ({
    titles: props.criteria.titles.join(", "),
    seniority: props.criteria.seniority.join(", "),
    locations: props.criteria.locations.join(", "),
    remote: props.criteria.remote,
    payFloor:
      props.criteria.compFloorCents === null
        ? ""
        : String(Math.trunc(props.criteria.compFloorCents / 100)),
    mustHave: props.criteria.mustHave.join(", "),
    niceToHave: props.criteria.niceToHave.join(", "),
    dealbreakers: props.criteria.dealbreakers.join(", "),
    excludeCompanies: props.criteria.excludeCompanies.join(", "),
    wantNarrative: props.criteria.wantNarrative
  }));

  const set = (field: keyof typeof draft, value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));

  return (
    <form
      className="jsm-criteria-editor"
      onSubmit={(event: { preventDefault(): void }) => {
        event.preventDefault();
        const dollars = draft.payFloor.trim() === "" ? null : Number(draft.payFloor);
        props.onSave({
          titles: splitList(draft.titles),
          seniority: splitList(draft.seniority),
          locations: splitList(draft.locations),
          remote: draft.remote,
          compFloorCents: dollars !== null && Number.isFinite(dollars) ? dollars * 100 : null,
          mustHave: splitList(draft.mustHave),
          niceToHave: splitList(draft.niceToHave),
          dealbreakers: splitList(draft.dealbreakers),
          excludeCompanies: splitList(draft.excludeCompanies),
          wantNarrative: draft.wantNarrative
        });
      }}
    >
      {LIST_FIELDS.map(([field, label]) => (
        <label key={field} className="jsm-criteria-editor__field">
          <span className="jds-label">{label}</span>
          <input
            className="jds-input"
            value={draft[field]}
            onChange={(event: { target: { value: string } }) => set(field, event.target.value)}
          />
        </label>
      ))}
      <label className="jsm-criteria-editor__field">
        <span className="jds-label">Remote</span>
        <select
          className="jds-select"
          value={draft.remote}
          onChange={(event: { target: { value: string } }) => set("remote", event.target.value)}
        >
          {Object.entries(REMOTE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="jsm-criteria-editor__field">
        <span className="jds-label">Pay floor</span>
        <input
          className="jds-input"
          type="number"
          min="0"
          step="1000"
          value={draft.payFloor}
          onChange={(event: { target: { value: string } }) => set("payFloor", event.target.value)}
        />
      </label>
      <label className="jsm-criteria-editor__field jsm-criteria-editor__field--wide">
        <span className="jds-label">What you want</span>
        <textarea
          className="jds-textarea"
          rows={5}
          value={draft.wantNarrative}
          onChange={(event: { target: { value: string } }) =>
            set("wantNarrative", event.target.value)
          }
        />
      </label>
      <div className="jsm-criteria-editor__actions">
        <button type="submit" className="jds-btn jds-btn--primary" disabled={props.saving}>
          {props.saving ? "Saving…" : "Save changes"}
        </button>
        <button type="button" className="jds-btn jds-btn--quiet" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function LookingForSection(props: {
  state: CriteriaState;
  editing: boolean;
  saveStatus: "idle" | "saving" | "saved" | "error";
  onEdit(): void;
  onCancel(): void;
  onSave(criteria: SearchCriteria): void;
  onRemove(field: keyof SearchCriteria, item: string): void;
}): ReactNodeLike {
  const { state } = props;
  if (state.status === "loading") {
    return (
      <section className="jsm-settings__group">
        <SectionHead label="What it's looking for" />
        <p className="jds-hint" role="status">
          Loading…
        </p>
      </section>
    );
  }
  if (state.status === "error") {
    return (
      <section className="jsm-settings__group">
        <SectionHead label="What it's looking for" />
        <p className="jds-hint" role="alert">
          Couldn&rsquo;t load your search criteria.
        </p>
      </section>
    );
  }
  const { criteria } = state;
  if (props.editing) {
    return (
      <section className="jsm-settings__group">
        <SectionHead label="What it's looking for" />
        <CriteriaEditor
          criteria={criteria}
          saving={props.saveStatus === "saving"}
          onCancel={props.onCancel}
          onSave={props.onSave}
        />
      </section>
    );
  }
  const wantNarrative = criteria.wantNarrative?.trim();
  return (
    <section className="jsm-settings__group">
      <SectionHead label="What it's looking for">
        <button type="button" className="jds-btn jds-btn--quiet jds-btn--sm" onClick={props.onEdit}>
          Edit
        </button>
      </SectionHead>
      <div className="jsm-fields">
        <FieldPair label="Titles">
          <ChipGroup
            items={criteria.titles}
            emptyLabel="No titles yet."
            onRemove={(item) => props.onRemove("titles", item)}
          />
        </FieldPair>
        <FieldPair label="Seniority">
          <ChipGroup
            items={criteria.seniority}
            emptyLabel="No seniority level yet."
            onRemove={(item) => props.onRemove("seniority", item)}
          />
        </FieldPair>
        <FieldPair label="Locations">
          <ChipGroup
            items={criteria.locations}
            emptyLabel="No locations yet."
            onRemove={(item) => props.onRemove("locations", item)}
          />
        </FieldPair>
        <FieldPair label="Remote">
          <select
            className="jds-select"
            aria-label="Remote preference"
            value={criteria.remote}
            disabled={props.saveStatus === "saving"}
            onChange={(event: { target: { value: string } }) =>
              props.onSave({
                ...criteria,
                remote: event.target.value as SearchCriteria["remote"]
              })
            }
          >
            {Object.entries(REMOTE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </FieldPair>
        <FieldPair label="Pay floor">
          <PayFloorControl
            cents={criteria.compFloorCents}
            saving={props.saveStatus === "saving"}
            onSave={(compFloorCents) => props.onSave({ ...criteria, compFloorCents })}
          />
        </FieldPair>
      </div>
      <div className="jsm-fields">
        <FieldPair label="Must have">
          <ChipGroup
            items={criteria.mustHave}
            emptyLabel="Nothing marked must-have yet."
            onRemove={(item) => props.onRemove("mustHave", item)}
          />
        </FieldPair>
        <FieldPair label="Nice to have">
          <ChipGroup
            items={criteria.niceToHave}
            emptyLabel="Nothing marked nice-to-have yet."
            onRemove={(item) => props.onRemove("niceToHave", item)}
          />
        </FieldPair>
        <FieldPair label="Dealbreakers">
          <ChipGroup
            items={criteria.dealbreakers}
            emptyLabel="No dealbreakers marked yet."
            onRemove={(item) => props.onRemove("dealbreakers", item)}
          />
        </FieldPair>
      </div>
      <p className="jds-hint">
        {wantNarrative && wantNarrative.length > 0
          ? wantNarrative
          : "Nothing said yet about what you actually want out of this search."}
      </p>
      {props.saveStatus === "saved" ? (
        <p className="jds-hint" role="status">
          Saved. Existing matches will be reread.
        </p>
      ) : null}
      {props.saveStatus === "error" ? (
        <p className="jds-hint jds-hint--error" role="alert">
          Couldn&rsquo;t save these changes.
        </p>
      ) : null}
    </section>
  );
}

// -------------------------------------------------------------------------------------------
// Briefing detail
// -------------------------------------------------------------------------------------------
const BRIEFING_DETAIL_LEVELS: Record<BriefingDetail, { label: string; blurb: string }> = {
  count: { label: "Count only", blurb: "Say how many new matches there are, nothing else." },
  top: { label: "Top matches", blurb: "Include the best few, with why each one matched." },
  full: { label: "Full detail", blurb: "Include everything about every new match." }
};

const BRIEFING_DETAIL_ORDER: BriefingDetail[] = ["count", "top", "full"];

function isBriefingDetail(value: string | null): value is BriefingDetail {
  return value === "count" || value === "top" || value === "full";
}

function BriefingDetailSection(props: {
  briefingDetail: BriefingDetail;
  saveStatus: "idle" | "saving" | "saved" | "error";
  onChange: (next: BriefingDetail) => void;
}): ReactNodeLike {
  const { briefingDetail, onChange, saveStatus } = props;
  return (
    <section className="jsm-settings__group">
      <SectionHead label="Briefing detail" />
      <div className="jsm-rail">
        <div className="jsm-rail__row">
          <div className="jsm-rail__main">
            <span className="jds-label">How much to include</span>
            <p className="jds-hint">{BRIEFING_DETAIL_LEVELS[briefingDetail].blurb}</p>
          </div>
          <div className="jsm-rail__control">
            <div className="jds-segmented" role="group" aria-label="Briefing detail">
              {BRIEFING_DETAIL_ORDER.map((level) => (
                <button
                  key={level}
                  type="button"
                  className="jds-segmented__opt"
                  aria-pressed={briefingDetail === level}
                  disabled={saveStatus === "saving"}
                  onClick={() => onChange(level)}
                >
                  {BRIEFING_DETAIL_LEVELS[level].label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      {saveStatus === "saving" ? (
        <p className="jds-hint" role="status">
          Saving…
        </p>
      ) : null}
      {saveStatus === "saved" ? (
        <p className="jds-hint" role="status">
          Saved.
        </p>
      ) : null}
      {saveStatus === "error" ? (
        <p className="jds-hint jds-hint--error" role="alert">
          Couldn&rsquo;t save this preference.
        </p>
      ) : null}
    </section>
  );
}

// -------------------------------------------------------------------------------------------
// ProfileScreen
// -------------------------------------------------------------------------------------------
export interface ProfileScreenProps {
  profile: Profile;
  onChangeInChat?: () => void;
  // A counter, bumped by the board's "Add résumé" button as it switches to this tab. Passed
  // straight down to the résumé editor, which opens itself whenever the value changes. Optional
  // because arriving here by clicking the Profile tab has no such intent.
  openResumeSignal?: number;
  /** Root's own hook for "a résumé now exists" — it gates the first crawl.run on exactly that
   *  (see the crawl effect in root.tsx for why the ordering is load-bearing), and nothing else
   *  in this screen's lifecycle tells it. Optional so the unit renderer can omit it. */
  onResumeSaved?: () => void;
  onProfileChanged?: () => void;
}

export function ProfileScreen(props: ProfileScreenProps): ReactNodeLike {
  const { profile } = props;
  const [resume, setResume] = useState<ResumeState>({ status: "loading" });
  const [criteria, setCriteria] = useState<CriteriaState>({ status: "loading" });
  const [briefingDetail, setBriefingDetail] = useState<BriefingDetail>(
    isBriefingDetail(profile.briefingDetail) ? profile.briefingDetail : "top"
  );
  const [briefingSaveStatus, setBriefingSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const briefingSaveRevision = useRef(0);
  const [editingCriteria, setEditingCriteria] = useState(false);
  const [criteriaSaveStatus, setCriteriaSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const criteriaSaveRevision = useRef(0);
  const [nameDraft, setNameDraft] = useState(profile.name);
  const [nameStatus, setNameStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    setNameDraft(profile.name);
    setNameStatus("idle");
  }, [profile.profileId, profile.name]);

  useEffect(() => {
    setBriefingDetail(isBriefingDetail(profile.briefingDetail) ? profile.briefingDetail : "top");
  }, [profile.profileId, profile.briefingDetail]);

  useEffect(() => {
    setBriefingSaveStatus("idle");
  }, [profile.profileId]);

  useEffect(() => {
    let cancelled = false;
    setResume({ status: "loading" });
    fetchResume(profile.profileId)
      .then((resumeValue) => {
        if (!cancelled) setResume({ status: "ready", resume: resumeValue });
      })
      .catch(() => {
        if (!cancelled) setResume({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [profile.profileId]);

  // Reloads without flipping back through "loading" — a résumé save's own success/error feedback
  // lives inside ResumeEditor, and swapping the whole section out from under it mid-message would
  // hide what just happened. Same reconcile-by-refetch idiom as settings.tsx's refetchPortals
  // (ruling I5: a queued write never resolves "done" on its own).
  function reloadResume(): void {
    fetchResume(profile.profileId)
      .then((resumeValue) => {
        setResume({ status: "ready", resume: resumeValue });
        // Only tell root once the read confirms a résumé is actually on file — a save that
        // failed must not trip the first crawl.
        if (resumeValue !== null) props.onResumeSaved?.();
      })
      .catch(() => setResume({ status: "error" }));
  }

  useEffect(() => {
    let cancelled = false;
    setCriteria({ status: "loading" });
    fetchCriteria(profile.profileId)
      .then(({ criteria: criteriaValue, contextSummary }) => {
        if (!cancelled) setCriteria({ status: "ready", criteria: criteriaValue, contextSummary });
      })
      .catch(() => {
        if (!cancelled) setCriteria({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [profile.profileId]);

  function handleBriefingDetail(next: BriefingDetail): void {
    const revision = ++briefingSaveRevision.current;
    setBriefingDetail(next);
    setBriefingSaveStatus("saving");
    runQueue(PROFILE_SET_BRIEFING_DETAIL_QUEUE, "profile.set-briefing-detail", {
      profileId: profile.profileId,
      detail: next
    })
      .then((outcome) => {
        if (outcome.kind === "disabled" || outcome.kind === "error") {
          if (briefingSaveRevision.current === revision) setBriefingSaveStatus("error");
          return;
        }
        const confirm = (attempt: number): void => {
          invokeTool(PROFILE_GET_TOOL, { profileId: profile.profileId })
            .then((result) => {
              if (briefingSaveRevision.current !== revision) return;
              if ((result as { briefingDetail?: unknown } | null)?.briefingDetail === next) {
                setBriefingSaveStatus("saved");
                props.onProfileChanged?.();
              } else if (attempt < 20) {
                setTimeout(() => confirm(attempt + 1), 500);
              } else {
                setBriefingSaveStatus("error");
              }
            })
            .catch(() => {
              if (briefingSaveRevision.current === revision) setBriefingSaveStatus("error");
            });
        };
        confirm(0);
      })
      .catch(() => {
        if (briefingSaveRevision.current === revision) setBriefingSaveStatus("error");
      });
  }

  function saveCriteria(next: SearchCriteria): void {
    const revision = ++criteriaSaveRevision.current;
    setCriteriaSaveStatus("saving");
    setCriteria((current) =>
      current.status === "ready" ? { ...current, criteria: next } : current
    );
    runQueue(CRITERIA_SET_QUEUE, "criteria.set", {
      profileId: profile.profileId,
      criteriaJson: JSON.stringify(next)
    })
      .then((outcome) => {
        if (outcome.kind === "disabled" || outcome.kind === "error") {
          if (criteriaSaveRevision.current === revision) setCriteriaSaveStatus("error");
          return;
        }
        setEditingCriteria(false);
        const confirm = (attempt: number): void => {
          fetchCriteria(profile.profileId)
            .then((actual) => {
              if (criteriaSaveRevision.current !== revision) return;
              if (JSON.stringify(actual.criteria) === JSON.stringify(next)) {
                setCriteria({ status: "ready", ...actual });
                setCriteriaSaveStatus("saved");
              } else if (attempt < 20) {
                setTimeout(() => confirm(attempt + 1), 500);
              } else {
                setCriteriaSaveStatus("error");
              }
            })
            .catch(() => {
              if (criteriaSaveRevision.current === revision) setCriteriaSaveStatus("error");
            });
        };
        confirm(0);
      })
      .catch(() => {
        if (criteriaSaveRevision.current === revision) setCriteriaSaveStatus("error");
      });
  }

  function removeCriteriaItem(field: keyof SearchCriteria, item: string): void {
    if (criteria.status !== "ready") return;
    const current = criteria.criteria[field];
    if (!Array.isArray(current)) return;
    saveCriteria({ ...criteria.criteria, [field]: current.filter((value) => value !== item) });
  }

  function saveName(): void {
    const name = nameDraft.trim();
    if (name.length === 0 || name.length > 80) {
      setNameStatus("error");
      return;
    }
    setNameStatus("saving");
    runQueue(PROFILE_RENAME_QUEUE, "profile.rename", { profileId: profile.profileId, name })
      .then((outcome) => {
        if (outcome.kind === "disabled" || outcome.kind === "error") {
          setNameStatus("error");
          return;
        }
        const confirm = (attempt: number): void => {
          invokeTool(PROFILE_GET_TOOL, { profileId: profile.profileId })
            .then((result) => {
              if ((result as { name?: unknown } | null)?.name === name) {
                setNameStatus("saved");
                props.onProfileChanged?.();
              } else if (attempt < 10) {
                setTimeout(() => confirm(attempt + 1), 500);
              } else {
                setNameStatus("error");
              }
            })
            .catch(() => setNameStatus("error"));
        };
        confirm(0);
      })
      .catch(() => setNameStatus("error"));
  }

  return (
    <div className="jsm-settings jsm-settings--profile">
      <h2 className="jds-section-title">Profile</h2>
      <section className="jsm-settings__group">
        <SectionHead label="Search name" />
        <form
          className="jsm-profile-name"
          onSubmit={(event: { preventDefault(): void }) => {
            event.preventDefault();
            saveName();
          }}
        >
          <input
            className="jds-input"
            aria-label="Search name"
            maxLength={80}
            value={nameDraft}
            onChange={(event: { target: { value: string } }) => setNameDraft(event.target.value)}
          />
          <button
            type="submit"
            className="jds-btn jds-btn--secondary"
            disabled={nameStatus === "saving" || nameDraft.trim() === profile.name}
          >
            {nameStatus === "saving" ? "Saving…" : "Save name"}
          </button>
        </form>
        {nameStatus === "saved" ? (
          <p className="jds-hint" role="status">
            Saved.
          </p>
        ) : null}
        {nameStatus === "error" ? (
          <p className="jds-hint jds-hint--error" role="alert">
            Couldn&rsquo;t rename this search.
          </p>
        ) : null}
      </section>
      <LookingForSection
        state={criteria}
        editing={editingCriteria}
        saveStatus={criteriaSaveStatus}
        onEdit={() => {
          setCriteriaSaveStatus("idle");
          setEditingCriteria(true);
        }}
        onCancel={() => setEditingCriteria(false)}
        onSave={saveCriteria}
        onRemove={removeCriteriaItem}
      />
      <ContextSummarySection state={criteria} />
      <ResumeSection
        profileId={profile.profileId}
        state={resume}
        onSaved={reloadResume}
        openSignal={props.openResumeSignal}
      />
      <BriefingDetailSection
        briefingDetail={briefingDetail}
        saveStatus={briefingSaveStatus}
        onChange={handleBriefingDetail}
      />
    </div>
  );
}
