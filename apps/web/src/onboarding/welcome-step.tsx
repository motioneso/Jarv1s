export function WelcomeStep(props: { readonly onSkipAll: () => void }) {
  return (
    <section className="panel" aria-labelledby="onboarding-welcome-title">
      <div className="panel-heading">
        <h2 id="onboarding-welcome-title">Welcome to Jarv1s</h2>
      </div>
      <p>
        Let&apos;s get your assistant set up. We&apos;ll help you install a terminal multiplexer,
        authenticate a CLI, and optionally connect Google. Every step is optional — you can skip
        setup at any time and configure things later in Settings.
      </p>
      <button className="ghost-button" type="button" onClick={props.onSkipAll}>
        Skip setup
      </button>
    </section>
  );
}
