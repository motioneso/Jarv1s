import { useState } from "react";
import { Bot } from "lucide-react";

import { ChatDrawer } from "../chat/chat-drawer";
import { useChatStream } from "../chat/use-chat-stream";

/**
 * Optional Jarvis overlay mounted inside the onboarding wizard. Reuses the existing
 * live-chat drawer + SSE stream. It is INERT until `enabled` (a CLI chat path exists:
 * a multiplexer is selected AND the chosen provider's CLI is present). While disabled the
 * "Ask Jarvis" toggle is greyed out and no chat stream is opened — zero chat traffic.
 * It never gates step completion; the deterministic wizard works without it.
 */
export function OnboardingChatOverlay(props: { readonly enabled: boolean }) {
  const [open, setOpen] = useState(false);
  // useChatStream is only mounted (i.e. the hook only runs) when the overlay is both
  // enabled and open, so no SSE connection is opened while the toggle is disabled.
  return (
    <div className="onboarding-chat-overlay">
      <button
        className="ghost-button"
        type="button"
        disabled={!props.enabled}
        title={
          props.enabled
            ? "Ask Jarvis to help with the remaining steps"
            : "Available once you've selected a multiplexer and authenticated a CLI"
        }
        onClick={() => setOpen((v) => !v)}
      >
        <Bot size={18} aria-hidden="true" /> Ask Jarvis
      </button>
      {props.enabled && open ? <OnboardingChatPanel onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

/** Mounted only when enabled+open, so the SSE stream connects only then. */
function OnboardingChatPanel(props: { readonly onClose: () => void }) {
  const { records, clearRecords } = useChatStream();
  return <ChatDrawer open onClose={props.onClose} records={records} clearRecords={clearRecords} />;
}
