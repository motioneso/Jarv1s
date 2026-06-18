import { ConnectGooglePanel } from "../connectors/connect-google-panel";

const PLANNED_EMAIL_PROVIDERS = [
  "Outlook / Microsoft 365",
  "Proton Mail",
  "iCloud Mail",
  "Yahoo Mail",
  "Fastmail"
] as const;

export function ConnectorStep(props: { readonly done: boolean }) {
  return (
    <section
      className="onb-step onboarding-connector-step"
      aria-labelledby="onboarding-connector-title"
    >
      <p className="onb-eyebrow">Step 3 · Optional</p>
      <h1 id="onboarding-connector-title" className="onb-title">
        Connect your calendar and email.
      </h1>
      <p className="onb-lede">
        Google is ready now. Other inbox providers are planned as separate connector work, so this
        step can grow without blocking setup today.
      </p>
      <div className="onb-provider-strip" aria-label="Planned email providers">
        <span>Planned providers</span>
        {PLANNED_EMAIL_PROVIDERS.map((provider) => (
          <span className="onb-provider-pill" key={provider}>
            {provider}
          </span>
        ))}
      </div>
      {props.done ? (
        <p className="form-hint">A connector account is set up. You can move on.</p>
      ) : null}
      <ConnectGooglePanel />
    </section>
  );
}
