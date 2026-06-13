import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";

import type { ChatMultiplexerChoice, OnboardingMultiplexerStepDto } from "@jarv1s/shared";

import { setChatMultiplexerSettings } from "../api/client";
import { queryKeys } from "../api/query-keys";

export function MultiplexerStep(props: {
  readonly step: OnboardingMultiplexerStepDto;
  readonly onRecheck: () => void;
}) {
  const queryClient = useQueryClient();
  const select = useMutation({
    // Reuse the EXISTING audited writer — single owner of chat.multiplexer.
    mutationFn: (choice: ChatMultiplexerChoice) => setChatMultiplexerSettings(choice),
    onSuccess: async () => {
      // Invalidate BOTH the onboarding status and the settings chat-multiplexer query so the
      // adapter slice's settings panel (if open) stays consistent.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.status }),
        queryClient.invalidateQueries({ queryKey: queryKeys.settings.chatMultiplexer })
      ]);
    }
  });

  const anyUsable = props.step.tmuxUsable || props.step.herdrUsable;

  return (
    <section className="panel" aria-labelledby="onboarding-multiplexer-title">
      <div className="panel-heading">
        <h2 id="onboarding-multiplexer-title">Terminal multiplexer</h2>
      </div>
      {props.step.selected ? (
        <p className="form-hint">
          Selected: <strong>{props.step.selected}</strong>
          {props.step.done ? " (usable)" : " (selected, but not usable on this host yet)"}
        </p>
      ) : null}
      {!anyUsable ? (
        <>
          <p>
            Jarv1s runs unprivileged, so we can&apos;t install software for you. Install one of
            these on the host, then re-check. (herdr also needs a root pane — set
            <code>JARVIS_HERDR_ROOT_PANE</code> or run Jarv1s inside herdr.)
          </p>
          <ol className="connect-steps">
            <li>
              <code>sudo apt install tmux</code>
            </li>
            <li>
              Or install herdr: <code>curl -fsSL https://herdr.dev/install.sh | sh</code>
            </li>
          </ol>
        </>
      ) : (
        <div className="onboarding-choice-row">
          <button
            className="primary-button"
            type="button"
            disabled={!props.step.tmuxUsable || select.isPending}
            onClick={() => select.mutate("tmux")}
          >
            {select.isPending ? <LoaderCircle className="spin" size={18} /> : null} Use tmux
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={!props.step.herdrUsable || select.isPending}
            onClick={() => select.mutate("herdr")}
          >
            {select.isPending ? <LoaderCircle className="spin" size={18} /> : null} Use herdr
          </button>
          <button
            className="ghost-button"
            type="button"
            disabled={select.isPending}
            onClick={() => select.mutate("auto")}
            title="Let Jarv1s pick whichever usable multiplexer is installed"
          >
            Auto-detect
          </button>
        </div>
      )}
      <button className="ghost-button" type="button" onClick={props.onRecheck}>
        Re-check
      </button>
    </section>
  );
}
