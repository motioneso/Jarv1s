export function WelcomeStep(props: { readonly onSkipAll: () => void }) {
  return (
    <section className="onb-step" aria-labelledby="onboarding-welcome-title">
      <p className="onb-eyebrow">Setting up Jarvis</p>
      <h1 id="onboarding-welcome-title" className="onb-title">
        Let’s get your Jarvis set up.
      </h1>
      <p className="onb-lede">
        A couple of things are yours to configure: a safe way for me to reach your computer, and the
        assistant I’ll run on it. It takes a few minutes, and you can skip anything and come back to
        it later.
      </p>
      <div className="onb-ahead" aria-label="What setup covers">
        <div className="onb-ahead__row">
          <div className="onb-ahead__main">
            <div className="onb-ahead__label">A control channel</div>
            <div className="onb-ahead__sub">
              A safe, inspectable, interactive way for me to connect to your LLM.
            </div>
          </div>
          <span className="onb-ahead__n">01</span>
        </div>
        <div className="onb-ahead__row">
          <div className="onb-ahead__main">
            <div className="onb-ahead__label">The provider</div>
            <div className="onb-ahead__sub">
              Jarvis lets you utilize your favorite LLM provider, we’ll confirm a couple of things
              first.
            </div>
          </div>
          <span className="onb-ahead__n">02</span>
        </div>
        <div className="onb-ahead__row">
          <div className="onb-ahead__main">
            <div className="onb-ahead__label">Email</div>
            <div className="onb-ahead__sub">
              Optionally connect your email and calendar so Jarvis can help you more.
            </div>
          </div>
          <span className="onb-ahead__n">03</span>
        </div>
      </div>
      <div className="onb-foot-note">Already know what you’re doing? No worries.</div>
      <button className="onb-inline-skip" type="button" onClick={props.onSkipAll}>
        Skip for now
      </button>
    </section>
  );
}
