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
import { h, useEffect, useState, type ReactNodeLike } from "../runtime";
import { invokeTool, runQueue } from "../api";
import type { Profile } from "../use-profiles";
import type { BriefingDetail } from "../../domain/store-port.js";
import type { SearchCriteria } from "../../domain/records.js";
import type { AssistantSurfaceHandleV1 } from "../../domain/seed-prompt.js";
import { FieldPair, SectionHead } from "../keyline";
import { RESUME_GET_TOOL, ResumeSection, fetchResume, type ResumeState } from "./resume-editor";

export { RESUME_GET_TOOL };
export const PROFILE_GET_TOOL = "job-search.profile.get";
export const PROFILE_SET_BRIEFING_DETAIL_QUEUE = "job-search.profile-set-briefing-detail";

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

// Pure integer/string comma-grouping — no Intl.NumberFormat (banned by check:no-ambient-dates'
// sibling rule against ambient formatting APIs in web display layers).
function formatCompFloor(cents: number): string {
  const dollars = Math.trunc(Math.abs(cents) / 100);
  const digits = String(dollars);
  let grouped = "";
  for (let i = 0; i < digits.length; i++) {
    const fromEnd = digits.length - i;
    if (i > 0 && fromEnd % 3 === 0) grouped += ",";
    grouped += digits[i];
  }
  return `${cents < 0 ? "-" : ""}$${grouped}`;
}

function ChipGroup(props: { items: string[]; emptyLabel: string }): ReactNodeLike {
  if (props.items.length === 0) {
    return <p className="jds-hint">{props.emptyLabel}</p>;
  }
  return (
    <div className="jsm-chips">
      {/*
        jds-badge, not jds-chip. `.jds-chip`'s padding is deliberately lopsided —
        `space-1 space-1 space-1 space-3` — because it is built to carry a `jds-chip__x` remove
        button in the gap on the right. These titles and seniority levels are read-only, there is
        no remove button, and the reserved gap renders as a pill whose text sits visibly
        off-centre. Ben, looking at exactly these rows: "internal margins are the pills are not
        correct." `jds-badge --pill` is the design system's own symmetric static-tag primitive, so
        this is a swap to the right primitive rather than an override of the wrong one.
      */}
      {props.items.map((item, index) => (
        <span key={`${item}-${index}`} className="jds-badge jds-badge--pill jds-badge--neutral">
          {item}
        </span>
      ))}
    </div>
  );
}

function LookingForSection(props: {
  profile: Profile;
  state: CriteriaState;
  onChangeInChat?: () => void;
}): ReactNodeLike {
  const { profile, state } = props;
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
  const wantNarrative = criteria.wantNarrative?.trim();
  return (
    <section className="jsm-settings__group">
      <SectionHead label="What it's looking for">
        {props.onChangeInChat ? (
          <button
            type="button"
            className="jds-btn jds-btn--quiet jds-btn--sm"
            onClick={props.onChangeInChat}
          >
            Change in chat
          </button>
        ) : null}
      </SectionHead>
      <div className="jsm-fields">
        <FieldPair label="Titles">
          <ChipGroup items={criteria.titles} emptyLabel="No titles yet." />
        </FieldPair>
        <FieldPair label="Seniority">
          <ChipGroup items={criteria.seniority} emptyLabel="No seniority level yet." />
        </FieldPair>
        <FieldPair label="Locations">
          <ChipGroup items={criteria.locations} emptyLabel="No locations yet." />
        </FieldPair>
        <FieldPair label="Remote">{REMOTE_LABELS[criteria.remote]}</FieldPair>
        <FieldPair label="Pay floor">
          {criteria.compFloorCents === null
            ? "No minimum set."
            : formatCompFloor(criteria.compFloorCents)}
        </FieldPair>
      </div>
      <div className="jsm-fields">
        <FieldPair label="Must have">
          <ChipGroup items={criteria.mustHave} emptyLabel="Nothing marked must-have yet." />
        </FieldPair>
        <FieldPair label="Nice to have">
          <ChipGroup items={criteria.niceToHave} emptyLabel="Nothing marked nice-to-have yet." />
        </FieldPair>
        <FieldPair label="Dealbreakers">
          <ChipGroup items={criteria.dealbreakers} emptyLabel="No dealbreakers marked yet." />
        </FieldPair>
      </div>
      <p className="jds-hint">
        {wantNarrative && wantNarrative.length > 0
          ? wantNarrative
          : "Nothing said yet about what you actually want out of this search."}
      </p>
      <p className="jds-hint">
        {profile.readyToCrawl
          ? "Ready to search — every step above is answered."
          : "Still finishing setup. Answer what's left in chat and this search will start crawling."}
      </p>
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
  onChange: (next: BriefingDetail) => void;
}): ReactNodeLike {
  const { briefingDetail, onChange } = props;
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
                  onClick={() => onChange(level)}
                >
                  {BRIEFING_DETAIL_LEVELS[level].label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// -------------------------------------------------------------------------------------------
// ProfileScreen
// -------------------------------------------------------------------------------------------
export interface ProfileScreenProps {
  profile: Profile;
  assistantSurface?: AssistantSurfaceHandleV1;
  // A counter, bumped by the board's "Add résumé" button as it switches to this tab. Passed
  // straight down to the résumé editor, which opens itself whenever the value changes. Optional
  // because arriving here by clicking the Profile tab has no such intent.
  openResumeSignal?: number;
  /** Root's own hook for "a résumé now exists" — it gates the first crawl.run on exactly that
   *  (see the crawl effect in root.tsx for why the ordering is load-bearing), and nothing else
   *  in this screen's lifecycle tells it. Optional so the unit renderer can omit it. */
  onResumeSaved?: () => void;
}

export function ProfileScreen(props: ProfileScreenProps): ReactNodeLike {
  const { profile } = props;
  const [resume, setResume] = useState<ResumeState>({ status: "loading" });
  const [criteria, setCriteria] = useState<CriteriaState>({ status: "loading" });
  const [briefingDetail, setBriefingDetail] = useState<BriefingDetail>(
    isBriefingDetail(profile.briefingDetail) ? profile.briefingDetail : "top"
  );

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

  // Writes apply optimistically and reconcile via the next profile read (ruling I5 — runQueue
  // never resolves "done"); a failed enqueue is swallowed rather than rolled back visually, same
  // as settings.tsx's own portal toggle does on success, because there is nothing meaningful to
  // show inline for a control this small.
  function handleBriefingDetail(next: BriefingDetail): void {
    setBriefingDetail(next);
    runQueue(PROFILE_SET_BRIEFING_DETAIL_QUEUE, "profile.set-briefing-detail", {
      profileId: profile.profileId,
      detail: next
    }).catch(() => {});
  }

  return (
    <div className="jsm-settings">
      <h2 className="jds-section-title">Profile</h2>
      <LookingForSection
        profile={profile}
        state={criteria}
        onChangeInChat={
          props.assistantSurface
            ? () =>
                props.assistantSurface?.seedComposer(
                  `I want to change the criteria for the "${profile.name}" job search.`
                )
            : undefined
        }
      />
      <ContextSummarySection state={criteria} />
      <ResumeSection
        profileId={profile.profileId}
        state={resume}
        onSaved={reloadResume}
        openSignal={props.openResumeSignal}
      />
      <BriefingDetailSection briefingDetail={briefingDetail} onChange={handleBriefingDetail} />
    </div>
  );
}
