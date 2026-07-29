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
import { ONBOARDING_STEPS } from "../../domain/criteria.js";
import { FieldPair, formatPostedOn, SectionHead } from "../keyline";

// Read-only, same reason RESUME_GET_TOOL was read-only on settings.tsx before this move: this
// screen shows only whether a résumé exists and when it was last replaced — never the text, which
// is the one thing on this surface the user has no reason to re-read here and every reason not to
// have sitting on a profile page. Exported so a caller elsewhere (none today) can assert against
// the same literal rather than a retyped copy — same reasoning as the two exports below.
export const RESUME_GET_TOOL = "job-search.resume.get";

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

// What each onboarding step is called on screen. Duplicated from onboarding.tsx rather than
// imported — onboarding.tsx belongs to a different task's file set on this same branch (K3/K5
// concurrency), and the two screens showing this list have no shared caller to hoist it into
// without touching a file outside K4's grant. Keep the wording identical if either one changes;
// nothing enforces that today. Typed as a total record over the step union on purpose: adding a
// step to the domain list is a type error here until it has been given a name a person would
// recognize.
const STEP_LABELS: Record<(typeof ONBOARDING_STEPS)[number], string> = {
  role: "Role",
  want: "What you want",
  where: "Where",
  comp: "Pay",
  sources: "Job boards"
};

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

/** The "what it's looking for" section.
 *
 * Without K6 (optional, not built here) there is no read tool for the actual `SearchCriteria` —
 * §4 of the plan is explicit that `store.getProfile` has titles/seniority/locations/comp/etc. in
 * hand but nothing on the wire returns them yet. This section is therefore built entirely from
 * `completedSteps` + `readyToCrawl`, both already on the `profile.list` wire shape Root passes
 * down. It is written as one self-contained block precisely so a K6 upgrade is a data-source swap
 * inside this function, not a rewrite of the section's callers — nothing outside
 * `LookingForSection` needs to change shape when `completedSteps: OnboardingStep[]` becomes a real
 * `SearchCriteria` record. */
function LookingForSection(props: { profile: Profile }): ReactNodeLike {
  const done = new Set(props.profile.completedSteps);
  return (
    <section className="jsm-settings__group">
      <SectionHead label="What it&rsquo;s looking for" />
      {/* Pill-per-step, done vs. not — the same visual vocabulary onboarding.tsx already
          established for this exact data (jds-badge--forest for answered, jds-badge--outline for
          not yet), so a step read as "done" here reads as "done" the same way it does on the
          onboarding screen the user saw before this profile went active. */}
      <ol className="jsm-steps" aria-label="What we know so far">
        {ONBOARDING_STEPS.map((step) => (
          <li
            key={step}
            className={
              done.has(step)
                ? "jds-badge jds-badge--pill jds-badge--forest"
                : "jds-badge jds-badge--pill jds-badge--outline"
            }
            aria-label={`${STEP_LABELS[step]} — ${done.has(step) ? "answered" : "still needed"}`}
          >
            {STEP_LABELS[step]}
          </li>
        ))}
      </ol>
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

      <LookingForSection profile={profile} />

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
