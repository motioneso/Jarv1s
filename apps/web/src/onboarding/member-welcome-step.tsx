import { CircleCheck, Compass, Lock } from "lucide-react";

import { FootNote, StepHeader } from "./onboarding-ui";

export function MemberWelcomeStep(props: { readonly onSkipAll: () => void }) {
  return (
    <section className="onb-step" aria-labelledby="member-welcome-title">
      <StepHeader
        eyebrow="Welcome"
        title="You’ve got your own Jarvis."
        lede={
          <>
            Someone set up Jarvis and added you. The shared setup is already done, so I already work
            for you. Your tasks, calendar, wellness, and preferences are yours alone — no one else
            sees them.
          </>
        }
      />
      <div className="onb-ahead" aria-label="What getting started covers">
        <div className="onb-ahead__row">
          <span className="onb-ahead__ic">
            <CircleCheck size={19} aria-hidden="true" />
          </span>
          <div className="onb-ahead__main">
            <div className="onb-ahead__label">Already working</div>
            <div className="onb-ahead__sub">Nothing to install. I run on the shared setup.</div>
          </div>
          <span className="onb-ahead__n">01</span>
        </div>
        <div className="onb-ahead__row">
          <span className="onb-ahead__ic">
            <Lock size={19} aria-hidden="true" />
          </span>
          <div className="onb-ahead__main">
            <div className="onb-ahead__label">Private to you</div>
            <div className="onb-ahead__sub">Your data and connections stay private to you.</div>
          </div>
          <span className="onb-ahead__n">02</span>
        </div>
        <div className="onb-ahead__row">
          <span className="onb-ahead__ic">
            <Compass size={19} aria-hidden="true" />
          </span>
          <div className="onb-ahead__main">
            <div className="onb-ahead__label">A quick look around</div>
            <div className="onb-ahead__sub">
              Where to start, and what each part of Jarvis is for.
            </div>
          </div>
          <span className="onb-ahead__n">03</span>
        </div>
      </div>
      <FootNote>
        You can stop here and explore on your own. Nothing about this is required.
      </FootNote>
      <button className="onb-inline-skip" type="button" onClick={props.onSkipAll}>
        Skip for now
      </button>
    </section>
  );
}
