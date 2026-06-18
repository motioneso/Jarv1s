import { GoogleConnectorStep } from "./google-connector-step";

export function ConnectorStep(props: { readonly done: boolean }) {
  return (
    <GoogleConnectorStep
      done={props.done}
      eyebrow="Step 3 · Optional"
      title="Connect to email and calendar"
      lede="Connect your email and calendar accounts below. You can link multiple accounts."
      privacy="Your data never leaves your computer, and you can disconnect at any time."
    />
  );
}
