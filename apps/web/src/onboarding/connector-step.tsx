import { ConnectGooglePanel } from "../connectors/connect-google-panel";

export function ConnectorStep(props: { readonly done: boolean }) {
  return (
    <section className="onboarding-connector-step" aria-labelledby="onboarding-connector-title">
      <h2 id="onboarding-connector-title" className="onboarding-connector-title">
        Connect Google (optional)
      </h2>
      {props.done ? (
        <p className="form-hint">A connector account is set up. You can move on.</p>
      ) : null}
      <ConnectGooglePanel />
    </section>
  );
}
