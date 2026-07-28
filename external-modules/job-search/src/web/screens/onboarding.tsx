// external-modules/job-search/src/web/screens/onboarding.tsx
// Task 19 (#1303): the screen a profile shows before it has criteria — what the search is
// for, how far the setup conversation has gotten, and nothing that pretends to be results.
// Root renders this in place of OnboardingPlaceholder whenever a profile's state is
// "in_conversation" (root.tsx's branch, Task 18).
//
// Progress comes from the record, never the transcript (ledger L9 — the UI is never made of
// model output): the chips render off the `completedSteps` array on the profile.list wire
// result, which the domain layer (Task 10) already decided. ONBOARDING_STEPS is imported from
// the domain layer rather than redeclared here so this screen's chip list can't drift the
// moment Task 10's step list changes.
//
// Markup ported from the prototype's `.jp-onb` block (variant-flow.tsx). The prototype directory
// was deleted from this branch (Task 23, #1307); its full source, including variant-flow.tsx and
// the README verdict that picked this layout, is preserved on branch `prototype/job-search-ui`
// at 137ae214003607cc9d5a38d0a43a3ea5b08f9636.
//
// #1331 restores the one piece Task 19 dropped: the block's fake conversation
// thread and composer simulated the assistant inline, and were rightly cut (root.tsx's header:
// the only way into the assistant here is hostActions.openAssistant) — but spec §7 calls for a
// REAL chat, full width, not zero chat. That real chat is the host's own `Surface`
// (`assistantSurface.Surface` below), already bound to this profile's thread by Task 17's
// `useProfileThread`; this screen never builds a second chat implementation. Card chrome and
// chip color come from the host's jds-* primitives (jds-card, jds-eyebrow, jds-badge), matching
// Root's other panels — styles.css stays layout-only.
import type { AssistantSurfaceHandleV1 } from "../../domain/seed-prompt.js";
import { ONBOARDING_STEPS } from "../../domain/criteria.js";
import { h, type ReactNodeLike } from "../runtime";
import type { Profile } from "../use-profiles";

/** What each onboarding step is called on screen.
 *
 * The chips used to render `ONBOARDING_STEPS` verbatim, so the live screen showed a row reading
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

export function OnboardingScreen(props: {
  profile: Profile;
  // Optional per loader.ts/ledger I1 — absent (or a host predating Surface), the screen still
  // renders its chips and copy and says the conversation is unavailable rather than throwing
  // (plan case 5).
  assistantSurface?: AssistantSurfaceHandleV1;
}): ReactNodeLike {
  const done = new Set(props.profile.completedSteps);
  const Surface = props.assistantSurface?.Surface;
  return (
    <div className="jds-card jds-card--sunken jsm-state jsm-onb">
      {/* No "Job search" eyebrow here: the host already labels this surface twice above the card
          (the page header and its own eyebrow), and a third copy inside the card was the first
          thing that read as unconsidered on a live instance. The card leads with its own question
          instead. */}
      <h2 className="jsm-onb__head">Let&rsquo;s work out what this search is for.</h2>
      <p className="jsm-onb__sub">
        Nothing gets crawled until we both know what we&rsquo;re looking for. You can stop and come
        back — I keep what we have so far.
      </p>
      {/* The count carries the progress; the chips only say which parts. Without it the row read
          as five decorative pills — on a live screen there was no way to tell you were being
          measured against anything, let alone how far along you were. It also carries the state
          for anyone who can't use the fill colour, which was the only signal before. */}
      {/* jds-eyebrow, not jds-label: jds-label is the host's form-control label (semibold, full
          text colour) and this labels nothing you type into. jds-eyebrow is the host's section-label
          utility and is what the rest of the module's small caps-labels already use. */}
      <p className="jds-eyebrow jsm-onb__count">
        {done.size} of {ONBOARDING_STEPS.length} answered
      </p>
      <ol className="jsm-onb__prog" aria-label="What we still need">
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
      <div className="jsm-onb__chat">
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
          <p className="jsm-onb__unavailable">The conversation isn&rsquo;t available right now.</p>
        )}
      </div>
    </div>
  );
}
