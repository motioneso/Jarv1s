import { GoogleConnectorStep } from "./google-connector-step";

export function MemberConnectorStep() {
  return (
    <GoogleConnectorStep
      eyebrow="Step 2 · Optional"
      title="Connect your accounts"
      lede="Connecting Google allows Jarvis to check your calendar for scheduling and scan email for new tasks."
      privacy="Your connected accounts are private to you and are not shared."
    />
  );
}
