import type { OnboardingCliAuthStepDto } from "@jarv1s/shared";

const CLI_LABELS: Record<string, { name: string; loginCommand: string }> = {
  anthropic: { name: "Claude", loginCommand: "claude login" },
  "openai-compatible": { name: "Codex", loginCommand: "codex login" },
  google: { name: "Gemini", loginCommand: "gemini" }
};

export function CliAuthStep(props: {
  readonly step: OnboardingCliAuthStepDto;
  readonly onRecheck: () => void;
}) {
  return (
    <section className="panel" aria-labelledby="onboarding-cli-title">
      <div className="panel-heading">
        <h2 id="onboarding-cli-title">Authenticate a CLI</h2>
      </div>
      <p>
        Authenticate a coding CLI on the host shell, then re-check. We only detect whether the
        binary is present — make sure you&apos;ve run its login command on the host.
      </p>
      <ul className="onboarding-cli-list">
        {props.step.providers.map((provider) => {
          const label = CLI_LABELS[provider.kind] ?? {
            name: provider.kind,
            loginCommand: provider.kind
          };
          return (
            <li key={provider.kind}>
              <strong>{label.name}</strong>{" "}
              {provider.cliPresent ? (
                <span className="form-hint">
                  detected — run its login on the host if you haven&apos;t
                </span>
              ) : (
                <span className="form-hint">
                  not detected. Install it, then run <code>{label.loginCommand}</code>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <button className="ghost-button" type="button" onClick={props.onRecheck}>
        Re-check
      </button>
    </section>
  );
}
