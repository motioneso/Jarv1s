import { Plug, Radio, ShieldCheck, Terminal } from "lucide-react";

import { FootNote, StepHeader } from "./onboarding-ui";

export function WelcomeStep(props: { readonly onSkipAll: () => void }) {
  return (
    <section className="onb-step" aria-labelledby="onboarding-welcome-title">
      <StepHeader
        eyebrow="Setting up Jarvis"
        title="Let’s get your Jarvis set up."
        lede={
          <>
            A couple of things are yours to configure: a safe way for me to reach your computer, and
            the AI provider I’ll run on it. It takes a few minutes, and you can skip anything and
            come back to it later.
          </>
        }
      />
      <div className="onb-ahead" aria-label="What setup covers">
        <div className="onb-ahead__row">
          <span className="onb-ahead__ic">
            <Radio size={19} aria-hidden="true" />
          </span>
          <div className="onb-ahead__main">
            <div className="onb-ahead__label">A control channel</div>
            <div className="onb-ahead__sub">
              A safe, inspectable way for me to reach your computer.
            </div>
          </div>
          <span className="onb-ahead__n">01</span>
        </div>
        <div className="onb-ahead__row">
          <span className="onb-ahead__ic">
            <Terminal size={19} aria-hidden="true" />
          </span>
          <div className="onb-ahead__main">
            <div className="onb-ahead__label">Your provider</div>
            <div className="onb-ahead__sub">
              The AI tool I run on your machine — I detect it, you test sign-in.
            </div>
          </div>
          <span className="onb-ahead__n">02</span>
        </div>
        <div className="onb-ahead__row">
          <span className="onb-ahead__ic">
            <Plug size={19} aria-hidden="true" />
          </span>
          <div className="onb-ahead__main">
            <div className="onb-ahead__label">Google</div>
            <div className="onb-ahead__sub">
              Optional. Calendar for context, email for task capture.
            </div>
          </div>
          <span className="onb-ahead__n">03</span>
        </div>
      </div>
      <FootNote icon={<ShieldCheck size={15} aria-hidden="true" />}>
        Everything here is optional. If you skip, Jarvis still opens — you just configure later.
      </FootNote>
      <button className="onb-inline-skip" type="button" onClick={props.onSkipAll}>
        Skip for now
      </button>
    </section>
  );
}
