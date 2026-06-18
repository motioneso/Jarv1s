import { GoogleConnectorStep } from "./google-connector-step";

export function MemberConnectorStep() {
  return (
    <GoogleConnectorStep
      eyebrow="Step 2 · Optional"
      title="Connect your accounts, if you like."
      lede="Optional. Connecting Google lets me read your calendar for context and watch email for things worth turning into tasks."
      privacy="Whatever you connect is private to you — not shared with anyone else."
    />
  );
}
