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
// variant-flow.tsx), minus its fake conversation thread and composer — those simulate the
// assistant inline, which this surface never does (root.tsx's header: the only way into the
// assistant here is hostActions.openAssistant). Card chrome and chip color come from the
// host's jds-* primitives (jds-card, jds-eyebrow, jds-badge), matching Root's other panels —
// styles.css stays layout-only.
import { ONBOARDING_STEPS } from "../../domain/criteria.js";
import { h, type ReactNodeLike } from "../runtime";
import type { Profile } from "../use-profiles";

export function OnboardingScreen(props: { profile: Profile }): ReactNodeLike {
  const done = new Set(props.profile.completedSteps);
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
    </div>
  );
}
