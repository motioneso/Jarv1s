import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Check, Download, ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";

import type { ChatMultiplexerChoice, OnboardingMultiplexerStepDto } from "@jarv1s/shared";

import { setChatMultiplexerSettings } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { OptionCard, StatusChip, StatusHint, StepHeader } from "./onboarding-ui";

const OPTIONS = [
  {
    id: "auto",
    name: "Auto",
    mono: "recommended",
    desc: "Detect and use the best available multiplexer on your computer."
  },
  {
    id: "tmux",
    name: "tmux",
    mono: "multiplexer",
    desc: "A standard terminal multiplexer. Must be installed on your computer."
  },
  {
    id: "herdr",
    name: "herdr",
    mono: "multiplexer",
    desc: "A project-oriented multiplexer. Requires a running root pane."
  }
] as const;

export function MultiplexerStep(props: {
  readonly step: OnboardingMultiplexerStepDto;
  readonly onRecheck: () => void;
}) {
  const queryClient = useQueryClient();
  const [selectedChoice, setSelectedChoice] = useState<ChatMultiplexerChoice>(
    props.step.selected ?? "auto"
  );
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
  const selected = select.isPending ? selectedChoice : (props.step.selected ?? selectedChoice);

  useEffect(() => {
    if (!select.isPending) setSelectedChoice(props.step.selected ?? "auto");
  }, [props.step.selected, select.isPending]);

  return (
    <section className="onb-step" aria-labelledby="onboarding-multiplexer-title">
      <StepHeader
        eyebrow="Step 1 · A safe way to reach your machine"
        title="Choose how Jarvis runs."
        lede="Jarvis runs commands on your computer. For security, all tasks execute inside a single, inspectable terminal session that you can monitor or stop at any time. Choose how to manage this session."
      />
      <div className="onb-opts">
        {OPTIONS.map((option) => {
          const state = option.id === "herdr" ? props.step.herdrUsable : props.step.tmuxUsable;
          const autoReady = option.id === "auto" && anyUsable;
          const ready = autoReady || state;
          const tone = ready ? "pine" : option.id === "auto" ? "steel" : "amber";
          const label = ready
            ? option.id === "auto"
              ? "Ready — host detected"
              : "Detected on this host"
            : option.id === "auto"
              ? "Will use what’s available"
              : "Not installed";
          const hint =
            !ready && option.id === "tmux"
              ? "Install tmux on the host, then re-check."
              : !ready && option.id === "herdr"
                ? "Install herdr and configure a root pane."
                : undefined;
          return (
            <OptionCard
              key={option.id}
              selected={selected === option.id}
              disabled={select.isPending}
              onClick={() => {
                setSelectedChoice(option.id);
                select.mutate(option.id);
              }}
              name={option.name}
              mono={option.mono}
              desc={option.desc}
            >
              <StatusChip
                tone={tone}
                icon={
                  select.isPending && selected === option.id ? (
                    <LoaderCircle className="spin" size={14} aria-hidden="true" />
                  ) : ready ? (
                    <Check size={14} aria-hidden="true" />
                  ) : (
                    <Download size={14} aria-hidden="true" />
                  )
                }
              >
                {select.isPending && selected === option.id ? "Saving…" : label}
              </StatusChip>
              <StatusHint>{hint}</StatusHint>
            </OptionCard>
          );
        })}
      </div>
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
        <div className="onb-recheck__main">
          Available multiplexers are scanned automatically. Re-check if you install one now.
        </div>
        <button
          className="jds-btn jds-btn--secondary jds-btn--sm"
          type="button"
          onClick={props.onRecheck}
        >
          <RefreshCw size={14} aria-hidden="true" />
          Re-check host
        </button>
      </div>
    </section>
  );
}
