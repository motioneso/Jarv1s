// external-modules/job-search/src/web/screens/profile.tsx
// K4 (2026-07-28 keyline-restructure plan): "what does it know about me". A MOVE, not an
// invention — the résumé and briefing-detail halves of settings.tsx live here now; "Job boards"
// stayed behind (K5 renames that remainder to Monitors). Do not read this file expecting a fresh
// design: every section below is settings.tsx's own logic, carried over verbatim except where the
// plan named a specific fix (the résumé date) or a specific shape change (résumé stats as
// `FieldPair`s instead of one composed sentence).
//
// Same forced read/write transport split as settings.tsx (rulings I3/I4): job-search.resume.get
// is risk:"read" so it goes through invokeTool; job-search.profile-set-briefing-detail is
// risk:"write" so invokeTool on it would 403 with confirmation_required before the tool ever
// runs (packages/ai/src/routes.ts:645-668) — it goes through the manual-run queue (runQueue)
// instead. runQueue only ever reports "queued" or "already-queued" (I5), never "done", so the
// briefing-detail write applies optimistically to local state and is reconciled by the next
// profile.list poll (use-profiles.ts), not assumed to have succeeded.
import { h, useEffect, useState, type ReactNodeLike } from "../runtime";
import { invokeTool, runQueue } from "../api";
import type { Profile } from "../use-profiles";
import type { BriefingDetail } from "../../domain/store-port.js";
import type { SearchCriteria } from "../../domain/records.js";
import { FieldPair, formatPostedOn, SectionHead } from "../keyline";

// Read-only, same reason RESUME_GET_TOOL was read-only on settings.tsx before this move: this
// screen shows only whether a résumé exists and when it was last replaced — never the text, which
// is the one thing on this surface the user has no reason to re-read here and every reason not to
// have sitting on a profile page. Exported so a caller elsewhere (none today) can assert against
// the same literal rather than a retyped copy — same reasoning as the two exports below.
export const RESUME_GET_TOOL = "job-search.resume.get";

// K6 (2026-07-28 keyline-restructure plan): the read tool LookingForSection's own K4 header
// anticipated — read-only for the same structural reason RESUME_GET_TOOL is: the manifest's
// risk:"read" is what lets this screen call it through invokeTool at all (a risk:"write" tool
// 403s with confirmation_required before it ever runs — rulings I3/I4). Exported so
// job-search-manifest-conformance.test.tsx's blind sweep and this screen's own unit test assert
// against the same literal, never a retyped copy.
export const PROFILE_GET_TOOL = "job-search.profile.get";

// Moved from settings.tsx unchanged (queue name dashes the tool's last two path segments, jobKind
// keeps the tool's own dotted handler name — root.tsx's existing job-search.crawl-run precedent).
// tests/unit/job-search-manifest-conformance.test.tsx now imports this literal from here instead
// of settings.tsx, because the write it names moved here — the manifest itself is unchanged, only
// which screen owns the call site.
export const PROFILE_SET_BRIEFING_DETAIL_QUEUE = "job-search.profile-set-briefing-detail";

// Exhaustive over BriefingDetail by construction, moved verbatim from settings.tsx: TS rejects
// this object literal if the union (domain/store-port.ts) ever gains or drops a member, since
// every key must be exactly one of "count" | "top" | "full" and all three are required.
const BRIEFING_DETAIL_LEVELS: Record<BriefingDetail, { label: string; blurb: string }> = {
  count: { label: "Count only", blurb: "Say how many new matches there are, nothing else." },
  top: { label: "Top matches", blurb: "Include the best few, with why each one matched." },
  full: { label: "Full detail", blurb: "Include everything about every new match." }
};

const BRIEFING_DETAIL_ORDER: BriefingDetail[] = ["count", "top", "full"];

function isBriefingDetail(value: string | null): value is BriefingDetail {
  return value === "count" || value === "top" || value === "full";
}

// What this screen keeps of a résumé: whether there is one, which version, when it changed, and
// how long it is. Deliberately NOT the text — resume.get returns the full content (it is the
// owner's own row, read under their own scope), and this screen drops it on arrival rather than
// holding a copy in component state to render a status line from. Moved verbatim from
// settings.tsx's ResumeSummary.
interface ResumeSummary {
  version: number;
  updatedAt: string;
  length: number;
}

type ResumeState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; resume: ResumeSummary | null };

async function fetchResume(profileId: string): Promise<ResumeSummary | null> {
  const result = (await invokeTool(RESUME_GET_TOOL, { profileId })) as {
    resume?: { version: number; content: string; updatedAt: string } | null;
  };
  const resume = result?.resume;
  if (!resume || typeof resume.content !== "string") return null;
  return { version: resume.version, updatedAt: resume.updatedAt, length: resume.content.length };
}

/** The résumé section.
 *
 * Read-only on purpose, and the reason is structural rather than a shortcut: a write from the
 * browser has to go through a declared queue, and the manifest's params vocabulary
 * (packages/module-sdk module-params.ts) has no free-text field type — there is no way to declare
 * a queue that carries a résumé. Chat is the write path, so this section's job is to say what is
 * on file and point at the place that changes it.
 *
 * Four `FieldPair`s rather than settings.tsx's old one composed sentence ("Version 3, saved Jul
 * 2…") — the plan's own instruction for this move, so each fact (on file, version, saved-on,
 * length) reads as its own stat instead of parsed out of a paragraph. */
function ResumeSection(props: { state: ResumeState }): ReactNodeLike {
  const state = props.state;
  if (state.status === "loading") {
    return (
      <section className="jsm-settings__group">
        <SectionHead label="Résumé" />
        <p className="jds-hint">Checking…</p>
      </section>
    );
  }
  if (state.status === "error") {
    return (
      <section className="jsm-settings__group">
        <SectionHead label="Résumé" />
        <p className="jds-hint">Couldn&rsquo;t check whether a résumé is on file.</p>
      </section>
    );
  }
  const resume = state.resume;
  // Previously `new Date(state.resume.updatedAt).toLocaleDateString()` (settings.tsx:193) —
  // resolves against the *ambient* locale and timezone and is banned in web display layers by
  // check:no-ambient-dates. formatPostedOn (keyline.tsx, hoisted from board.tsx by K1) is the
  // established string-arithmetic replacement; reusing it here rather than writing a second date
  // formatter is what K3's own header calls out as the point of hoisting it in the first place —
  // one implementation, not two drifting copies. It renders null on a malformed/absent instant,
  // which reads as "—" below rather than a thrown error or a fabricated date.
  const savedOn = resume ? (formatPostedOn(resume.updatedAt) ?? "—") : "—";
  return (
    <section className="jsm-settings__group">
      <SectionHead label="Résumé">
        {resume === null ? <span className="jds-badge jds-badge--outline">None yet</span> : null}
      </SectionHead>
      <div className="jsm-fields">
        <FieldPair label="On file">{resume ? "Yes" : "No"}</FieldPair>
        <FieldPair label="Version">{resume ? String(resume.version) : "—"}</FieldPair>
        <FieldPair label="Saved on">{savedOn}</FieldPair>
        <FieldPair label="Length">{resume ? `${resume.length} characters` : "—"}</FieldPair>
      </div>
      <p className="jds-hint">
        {resume === null
          ? "Nothing on file. Fit stays empty until there is one — it's the only thing Fit is " +
            "judged against. Paste yours into the chat and every role gets read again with it."
          : "Paste a new one into the chat to replace it."}
      </p>
    </section>
  );
}

// What this screen keeps of a profile's criteria: the exact `SearchCriteria` shape
// `job-search.profile.get` returns, plus `contextSummary` alongside it — team-lead reversed the
// original K6 call to fetch-and-drop that field (see ContextSummarySection below for the
// rendering half of that reversal). Both fields ride the same fetch/loading/error state because
// they come off the same tool call; splitting them into two effects would double the network
// round-trip for no benefit, since neither section can render before the other's data exists
// anyway.
type CriteriaState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; criteria: SearchCriteria; contextSummary: string | null };

async function fetchCriteria(
  profileId: string
): Promise<{ criteria: SearchCriteria; contextSummary: string | null }> {
  const result = (await invokeTool(PROFILE_GET_TOOL, { profileId })) as {
    criteria?: SearchCriteria;
    contextSummary?: string | null;
  };
  if (!result || typeof result !== "object" || result.criteria == null) {
    throw new Error("profile.get returned no criteria");
  }
  return {
    criteria: result.criteria,
    contextSummary: typeof result.contextSummary === "string" ? result.contextSummary : null
  };
}

// Independent of CONTEXT_SUMMARY_MAX (domain/criteria.ts), which caps what gets WRITTEN to
// storage at 1200 characters — this caps what this screen RENDERS, so a future change to the
// store-side limit can't silently make this section grow past a readable size on its own. 320
// characters is roughly two short sentences at the `.jsm-summary` 68ch measure: enough for the
// narrative to frame the criteria below it without becoming the longest thing on the page (the
// criteria fields, not this paragraph, are the record of truth — see ContextSummarySection).
const CONTEXT_SUMMARY_RENDER_CAP = 320;

function truncateContextSummary(summary: string): string {
  if (summary.length <= CONTEXT_SUMMARY_RENDER_CAP) return summary;
  return `${summary.slice(0, CONTEXT_SUMMARY_RENDER_CAP).trimEnd()}…`;
}

/** The context-summary section — model-written prose, framing the criteria fields below it, never
 * standing in for them.
 *
 * Renders NOTHING (not an empty section, not a "Checking…" placeholder that resolves to a gap)
 * once loaded with no summary on file — a brand-new profile has none yet, and an empty heading
 * here would repeat the exact "wall of empty headings" LookingForSection's own empty states
 * already guard against. Renders nothing while loading or on error too, for the same reason: this
 * section is optional framing, not a fact the page owes the user an answer about the way "is
 * there a résumé on file" is — LookingForSection and ResumeSection still show their own
 * loading/error states because they always have something to say (yes/no, a count); this one may
 * legitimately have nothing to say at all.
 *
 * `contextSummary` is model-written prose persisted to a record — rendered as plain text inside
 * JSX (auto-escaped, never `dangerouslySetInnerHTML`) and nothing else. This function does not
 * branch on its content, does not parse it, and it is never concatenated into any prompt or tool
 * argument anywhere in this file. If this narrative and the criteria fields below ever disagree,
 * the fields are the truth — this section never introduces a fact that isn't also a field. */
function ContextSummarySection(props: { state: CriteriaState }): ReactNodeLike {
  const state = props.state;
  if (state.status !== "ready" || state.contextSummary === null) return null;
  const summary = state.contextSummary.trim();
  if (summary.length === 0) return null;
  return (
    <section className="jsm-settings__group">
      <SectionHead label="What I understand you&rsquo;re after" />
      <p className="jds-hint jsm-summary">{truncateContextSummary(summary)}</p>
    </section>
  );
}

// Exhaustive over SearchCriteria["remote"] by construction, same reason
// BRIEFING_DETAIL_LEVELS is: TS rejects this object literal if the union (domain/records.ts)
// ever gains or drops a member. "no-preference" — parseCriteriaPatch's own neutral default for a
// brand-new profile (domain/criteria.ts) — reads as "No preference" here, not as an alarming gap.
const REMOTE_LABELS: Record<SearchCriteria["remote"], string> = {
  required: "Remote required",
  preferred: "Remote preferred",
  "no-preference": "No preference",
  "onsite-ok": "Onsite OK"
};

// Cents to a whole-dollar, comma-grouped string by pure integer/string arithmetic — no
// Intl.NumberFormat, no toLocaleString. Same reason formatPostedOn (keyline.tsx) avoids
// Date#toLocaleDateString: both resolve against whatever locale happens to be ambient on the
// machine rendering them, banned in this module's web layer for exactly that reason.
function formatCompFloor(cents: number): string {
  const dollars = Math.trunc(Math.abs(cents) / 100);
  const digits = String(dollars);
  let grouped = "";
  for (let i = 0; i < digits.length; i++) {
    const remaining = digits.length - i;
    grouped += digits[i];
    if (remaining > 1 && remaining % 3 === 1) grouped += ",";
  }
  return `${cents < 0 ? "-" : ""}$${grouped}`;
}

/** One `FieldPair` value: a row of `jds-chip`s, or a one-line empty state when the list is empty
 * — a brand-new profile's criteria arrays all default to `[]` (domain/criteria.ts), and a wall of
 * empty chip rows under five headings reads worse than the checkmarks this section replaces. Keys
 * off `${item}-${index}` rather than the bare string: nothing stops two identical titles/
 * locations from being saved (no dedupe on this path), and a repeated key would be a silent React
 * bug, not a caught one. */
function ChipGroup(props: { items: string[]; emptyLabel: string }): ReactNodeLike {
  if (props.items.length === 0) {
    return <p className="jds-hint">{props.emptyLabel}</p>;
  }
  return (
    <div className="jsm-chips">
      {props.items.map((item, index) => (
        <span key={`${item}-${index}`} className="jds-chip">
          {item}
        </span>
      ))}
    </div>
  );
}

/** The "what it's looking for" section.
 *
 * K6 (2026-07-28 keyline-restructure plan): the data-source swap K4's own header comment on this
 * function anticipated — `job-search.profile.get` exists now, so this renders the real
 * `SearchCriteria` instead of onboarding-step pills. `readyToCrawl` (still on the `profile.list`
 * wire shape) stays as the closing hint; it is a fact about the whole profile, not part of the
 * criteria record, so it keeps coming from `props.profile` rather than `props.state`. */
function LookingForSection(props: { profile: Profile; state: CriteriaState }): ReactNodeLike {
  const state = props.state;
  if (state.status === "loading") {
    return (
      <section className="jsm-settings__group">
        <SectionHead label="What it&rsquo;s looking for" />
        <p className="jds-hint">Checking…</p>
      </section>
    );
  }
  if (state.status === "error") {
    return (
      <section className="jsm-settings__group">
        <SectionHead label="What it&rsquo;s looking for" />
        <p className="jds-hint">Couldn&rsquo;t read this profile&rsquo;s criteria.</p>
      </section>
    );
  }
  const criteria = state.criteria;
  const wantNarrative = criteria.wantNarrative.trim();
  return (
    <section className="jsm-settings__group">
      <SectionHead label="What it&rsquo;s looking for" />
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
        {wantNarrative.length > 0
          ? wantNarrative
          : "Nothing said yet about what you actually want out of this search."}
      </p>
      <p className="jds-hint">
        {props.profile.readyToCrawl
          ? "Ready to search — every step above is answered."
          : "Still finishing setup. Answer what's left in chat and this search will start crawling."}
      </p>
    </section>
  );
}

export function ProfileScreen(props: { profile: Profile }): ReactNodeLike {
  const { profile } = props;
  const [resume, setResume] = useState<ResumeState>({ status: "loading" });
  const [criteria, setCriteria] = useState<CriteriaState>({ status: "loading" });
  const [briefingDetail, setBriefingDetailState] = useState<BriefingDetail>(
    isBriefingDetail(profile.briefingDetail) ? profile.briefingDetail : "top"
  );

  useEffect(() => {
    setResume({ status: "loading" });
    let cancelled = false;
    fetchResume(profile.profileId)
      .then((summary) => {
        if (!cancelled) setResume({ status: "ready", resume: summary });
      })
      .catch(() => {
        if (!cancelled) setResume({ status: "error" });
      });
    return () => {
      // Switching profiles mid-flight would otherwise land the previous profile's résumé status
      // under the newly selected profile's name.
      cancelled = true;
    };
  }, [profile.profileId]);

  useEffect(() => {
    setCriteria({ status: "loading" });
    let cancelled = false;
    fetchCriteria(profile.profileId)
      .then((value) => {
        if (!cancelled) {
          setCriteria({
            status: "ready",
            criteria: value.criteria,
            contextSummary: value.contextSummary
          });
        }
      })
      .catch(() => {
        if (!cancelled) setCriteria({ status: "error" });
      });
    return () => {
      // Same switching-profiles-mid-flight guard as the résumé effect above.
      cancelled = true;
    };
  }, [profile.profileId]);

  function handleBriefingDetail(next: BriefingDetail): void {
    setBriefingDetailState(next);
    runQueue(PROFILE_SET_BRIEFING_DETAIL_QUEUE, "profile.set-briefing-detail", {
      profileId: profile.profileId,
      detail: next
    }).catch(() => {
      // Optimistic; a failed queue call corrects itself the next time this profile's record is
      // re-read — this screen doesn't duplicate profile.list's own poll cadence.
    });
  }

  return (
    <div className="jsm-settings">
      <header className="jsm-settings__head">
        <h2 className="jds-section-title">Profile</h2>
        <p className="jds-section-sub">
          What this search knows about you, and how much it says in your briefing.
        </p>
      </header>

      <ResumeSection state={resume} />

      <ContextSummarySection state={criteria} />
      <LookingForSection profile={profile} state={criteria} />

      {/* Briefing detail — moved verbatim from settings.tsx, including the jds-segmented control
          and its queue write. It already worked; nothing about its logic changed in this move. */}
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
                    onClick={() => handleBriefingDetail(level)}
                  >
                    {BRIEFING_DETAIL_LEVELS[level].label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
