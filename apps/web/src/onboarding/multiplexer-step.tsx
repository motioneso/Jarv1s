import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, LoaderCircle } from "lucide-react";

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
    <section className="onb-step" aria-labelledby="onboarding-multiplexer-title">
      <p className="onb-eyebrow">Step 1 · A safe way to reach your machine</p>
      <h1 id="onboarding-multiplexer-title" className="onb-title">
        Give Jarvis a control channel.
      </h1>
      <p className="onb-lede">
        I run on your computer. To do that safely, I keep my work inside a single, inspectable
        terminal session, so everything I run is in one place you can watch or stop.
      </p>
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
        <div className="onboarding-choice-row onb-option-actions">
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
      <div className="onb-install-links" aria-label="Official installation links">
        <span>Download:</span>
        <a href="https://github.com/tmux/tmux" target="_blank" rel="noreferrer">
          tmux <ExternalLink size={14} />
        </a>
        <a href="https://herdr.dev/docs/install/" target="_blank" rel="noreferrer">
          herdr <ExternalLink size={14} />
        </a>
      </div>
      <div className="onb-recheck">
        <p>
          Status reflects what is installed on the host, not what is running. You can change this
          later in Settings.
        </p>
        <button className="ghost-button" type="button" onClick={props.onRecheck}>
          Re-check host
        </button>
      </div>
    </section>
  );
}
