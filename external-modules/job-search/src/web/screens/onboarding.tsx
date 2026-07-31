// external-modules/job-search/src/web/screens/onboarding.tsx
// Task 19 (#1303): the screen a profile shows before it has criteria — what the search is
// for, how far the setup conversation has gotten, and nothing that pretends to be results.
// Root renders this in place of OnboardingPlaceholder whenever a profile's state is
// "in_conversation" (root.tsx's branch, Task 18).
//
// Redrawn (2026-07-29, keyline-restructure pass) to retire the last surface still wearing the
// pre-keyline design language: a `jds-card jds-card--sunken` floating card in a module that is
// now hairline rules and committed fields (Park Press's idiom is "no floating cards"), five
// `jds-badge--pill` chips Ben already ruled read badly here, and a plain `<h2>` where every
// other screen in the module now opens with display type. This pass gives it the same hero
// (eyebrow + `.jds-display` headline + gold strap, closed by an ink rule) Overview/Profile/
// Monitors already have, and turns the five steps into rail-led rows — the exact shape of
// overview.tsx's own `CheckpointRow` (`.jds-rail-row` + `.jds-rail--accent`/`--gold`/`--line` +
// a trailing word) — so the module has one step-row idiom, not two. Nothing about the data or
// the assistant surface below changes; only the chrome around them does.
//
// Progress comes from the record, never the transcript (ledger L9 — the UI is never made of
// model output): the rows render off the `completedSteps` array on the profile.list wire
// result, which the domain layer (Task 10) already decided. ONBOARDING_STEPS is imported from
// the domain layer rather than redeclared here so this screen's step list can't drift the
// moment Task 10's step list changes.
//
// Markup originally ported from the prototype's `.jp-onb` block (variant-flow.tsx, preserved on
// branch `prototype/job-search-ui` at 137ae214003607cc9d5a38d0a43a3ea5b08f9636) — this pass
// keeps its copy and structure below the hero, only replacing the card/chip chrome.
//
// #1331 restores the one piece Task 19 dropped: the block's fake conversation
// thread and composer simulated the assistant inline, and were rightly cut (root.tsx's header:
// the only way into the assistant here is hostActions.openAssistant) — but spec §7 calls for a
// REAL chat, full width, not zero chat. That real chat is the host's own `Surface`
// (`assistantSurface.Surface` below), already bound to this profile's thread by Task 17's
// `useProfileThread`; this screen never builds a second chat implementation. Do not touch that
// binding — only what surrounds it. Card chrome is gone; colour and type come from the host's
// jds-* primitives (jds-eyebrow, jds-display, jds-rail, jds-strap), matching Root's other
// panels — styles-screens.css stays layout-only.
import type { AssistantSurfaceHandleV1 } from "../../domain/seed-prompt.js";
import { ONBOARDING_STEPS } from "../../domain/criteria.js";
import { h, type ReactNodeLike } from "../runtime";
import type { Profile } from "../use-profiles";

/** What each onboarding step is called on screen.
 *
 * The rows used to render `ONBOARDING_STEPS` verbatim, so the live screen showed a row reading
 * "role want where comp sources" — internal field names, lowercase, leaked straight into the
 * product. Typed as a total record over the step union on purpose: adding a step to the domain
 * list is a type error here until it has been given a name a person would recognize, rather than
 * silently appearing as another identifier. */
const STEP_LABELS: Record<(typeof ONBOARDING_STEPS)[number], string> = {
  role: "Role",
  want: "What you want",
  where: "Where",
  comp: "Pay",
  sources: "Job boards"
};

type StepStatus = "done" | "now" | "todo";

interface OnbStep {
  step: (typeof ONBOARDING_STEPS)[number];
  label: string;
  status: StepStatus;
}

// Same walk as overview.tsx's `buildCheckpoints`: the first not-yet-answered step is "now" (the
// one the conversation is currently on), everything after it is "todo" — so the rail reads as a
// single moving line rather than an undifferentiated "answered / not answered" split.
function buildSteps(done: ReadonlySet<(typeof ONBOARDING_STEPS)[number]>): OnbStep[] {
  let sawCurrent = false;
  return ONBOARDING_STEPS.map((step) => {
    let status: StepStatus;
    if (done.has(step)) {
      status = "done";
    } else if (!sawCurrent) {
      status = "now";
      sawCurrent = true;
    } else {
      status = "todo";
    }
    return { step, label: STEP_LABELS[step], status };
  });
}

function StepRow(props: { key?: string; step: OnbStep }): ReactNodeLike {
  const { step } = props;
  const railTone = step.status === "done" ? "accent" : step.status === "now" ? "gold" : "line";
  const word = step.status === "done" ? "Done" : step.status === "now" ? "Now" : "To do";
  return (
    // The row itself carries the aria-label (as the old chip did) rather than a wrapping element
    // — a screen reader announcing "Role — answered" / "Role — still needed" per step is the
    // whole point, and "now" vs "todo" both collapse to "still needed" here: that distinction is
    // the rail colour and trailing word's job, not a third aria state to invent.
    <li
      className="jds-rail-row jsm-onb-step-row"
      aria-label={`${step.label} — ${step.status === "done" ? "answered" : "still needed"}`}
    >
      <span className={`jds-rail jds-rail--${railTone}`} />
      <span className="jds-eyebrow">{step.label}</span>
      {/* Same tint overview.tsx's CheckpointRow gives its own "Done" word, and for the same
          reason — one word marked, the rest stay neutral. */}
      <span className={`jds-eyebrow${step.status === "done" ? " jds-eyebrow--accent" : ""}`}>
        {word}
      </span>
    </li>
  );
}

export function OnboardingScreen(props: {
  profile: Profile;
  // Optional per loader.ts/ledger I1 — absent (or a host predating Surface), the screen still
  // renders its rows and copy and says the conversation is unavailable rather than throwing
  // (plan case 5).
  assistantSurface?: AssistantSurfaceHandleV1;
}): ReactNodeLike {
  const done = new Set(props.profile.completedSteps);
  const steps = buildSteps(done);
  const Surface = props.assistantSurface?.Surface;
  return (
    // `.jsm-overview`'s flex-column, 2rem-gap rhythm — the same top-level stack Overview itself
    // uses for hero / divider / body — rather than a screen-specific rule saying the same thing.
    <div className="jsm-overview jsm-onb">
      {/* No "Job search" eyebrow here: the host already labels this surface twice above the
          screen (the page header and its own eyebrow), and a third copy inside the hero was the
          first thing that read as unconsidered on a live instance. The eyebrow carries progress
          instead — the count is the fact this hero actually has to state. */}
      <header className="jsm-onb-head">
        <span className="jds-eyebrow jds-eyebrow--gold">
          {done.size} of {ONBOARDING_STEPS.length} answered
        </span>
        <h2 className="jds-display jds-display--sm">
          Let&rsquo;s work out what this search is for.
        </h2>
        <span className="jds-strap jds-strap--gold" aria-hidden="true" />
        <p className="jds-hint jsm-onb-lede">
          Nothing gets crawled until we both know what we&rsquo;re looking for. You can stop and
          come back — I keep what we have so far.
        </p>
      </header>

      <div className="jds-divider jds-divider--ink" />

      {/* An <ol> because the five steps are asked in order; the list chrome (bullets, padding)
          is reset in styles-screens.css — only the sequence semantics are wanted. The count
          above already carries the overall progress for anyone who can't read the rail colour;
          this list carries which parts, same division of labour the old chip row had. */}
      <ol className="jsm-onb-steps" aria-label="What we still need">
        {steps.map((step) => (
          <StepRow key={step.step} step={step} />
        ))}
      </ol>

      <div className="jsm-onb-chat">
        {Surface ? (
          // A `composer` key is required at all — see the `Surface` doc comment on
          // seed-prompt.ts's `AssistantSurfaceHandleV1`: an absent `composer` renders no input box
          // whatsoever during the one screen where the conversation is the whole product.
          //
          // The placeholder is set rather than left as the host's generic "Message Jarvis…". On
          // this screen the user has just been told five things are needed and handed an empty
          // box, with nothing anywhere saying what a first message looks like. Naming the first
          // step in the box is the cheapest possible answer to "what do I type".
          h(Surface, { composer: { placeholder: "Tell me the kind of role you're after…" } })
        ) : (
          <p className="jds-hint jsm-onb-unavailable">
            The conversation isn&rsquo;t available right now.
          </p>
        )}
      </div>
    </div>
  );
}
