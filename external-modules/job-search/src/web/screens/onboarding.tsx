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
// Markup ported from the prototype's `.jp-onb` block (apps/web/src/job-search-prototype/
// variant-flow.tsx). #1331 restores the one piece Task 19 dropped: the block's fake conversation
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
      <span className="jds-eyebrow">Job search</span>
      <p className="jsm-onb__head">Let&rsquo;s work out what this search is for.</p>
      <p className="jsm-onb__sub">
        Nothing gets crawled until we both know what we&rsquo;re looking for. You can stop and come
        back — I keep what we have so far.
      </p>
      <div className="jsm-onb__prog">
        {ONBOARDING_STEPS.map((step) => (
          <span
            key={step}
            className={
              done.has(step)
                ? "jds-badge jds-badge--pill jds-badge--forest"
                : "jds-badge jds-badge--pill jds-badge--outline"
            }
          >
            {step}
          </span>
        ))}
      </div>
      <div className="jsm-onb__chat">
        {Surface ? (
          // `composer: {}` turns the composer on with the host's default placeholder — see the
          // `Surface` doc comment on seed-prompt.ts's `AssistantSurfaceHandleV1`: an absent
          // `composer` renders no input box at all, which would leave the user nothing to type
          // into during the one screen where the conversation is the whole product.
          h(Surface, { composer: {} })
        ) : (
          <p className="jsm-onb__unavailable">The conversation isn&rsquo;t available right now.</p>
        )}
      </div>
    </div>
  );
}
