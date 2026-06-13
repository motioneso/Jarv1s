export function MemberWelcomeStep(props: { readonly onSkipAll: () => void }) {
  return (
    <section className="panel" aria-labelledby="member-welcome-title">
      <div className="panel-heading">
        <h2 id="member-welcome-title">Welcome to Jarv1s</h2>
      </div>
      <p>
        You&apos;ve been added to this household instance. Your data is private to you — the
        assistant already works out of the box. Connect your own accounts if you like; every step is
        optional and you can skip setup at any time.
      </p>
      <button className="ghost-button" type="button" onClick={props.onSkipAll}>
        Skip setup
      </button>
    </section>
  );
}
