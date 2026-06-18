export function MemberWelcomeStep(props: { readonly onSkipAll: () => void }) {
  return (
    <section className="onb-step" aria-labelledby="member-welcome-title">
      <p className="onb-eyebrow">Welcome</p>
      <h1 id="member-welcome-title" className="onb-title">
        You’ve got your own Jarvis.
      </h1>
      <p className="onb-lede">
        Someone set up Jarvis and added you. The shared setup is already done, so I already work for
        you. Your tasks, calendar, wellness, and preferences are yours alone. No one else sees them.
      </p>
      <div className="onb-ahead" aria-label="What getting started covers">
        <div className="onb-ahead__row">
          <div className="onb-ahead__main">
            <div className="onb-ahead__label">Already working</div>
            <div className="onb-ahead__sub">Nothing to install. I run on the shared setup.</div>
          </div>
          <span className="onb-ahead__n">01</span>
        </div>
        <div className="onb-ahead__row">
          <div className="onb-ahead__main">
            <div className="onb-ahead__label">Private to you</div>
            <div className="onb-ahead__sub">Your data and connections stay private to you.</div>
          </div>
          <span className="onb-ahead__n">02</span>
        </div>
        <div className="onb-ahead__row">
          <div className="onb-ahead__main">
            <div className="onb-ahead__label">A quick look around</div>
            <div className="onb-ahead__sub">
              Where to start, and what each part of Jarvis is for.
            </div>
          </div>
          <span className="onb-ahead__n">03</span>
        </div>
      </div>
      <div className="onb-foot-note">
        You can stop here and explore on your own. Nothing about this is required.
      </div>
      <button className="onb-inline-skip" type="button" onClick={props.onSkipAll}>
        Skip for now
      </button>
    </section>
  );
}
