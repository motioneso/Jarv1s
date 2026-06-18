import { GoogleConnectorStep } from "./google-connector-step";

export function ConnectorStep(props: { readonly done: boolean }) {
  return (
    <GoogleConnectorStep
      done={props.done}
      eyebrow="Step 3 · Optional"
      title="Connect to email and calendar"
      lede="Connect your preferred email and calendar services below. Multiple accounts are supported."
      privacy="Nothing leaves your machine, and you can disconnect anytime."
    />
  );
}
