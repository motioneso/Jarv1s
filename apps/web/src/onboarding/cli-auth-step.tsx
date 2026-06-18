import { useState } from "react";
import {
  CircleCheck,
  CircleDashed,
  ExternalLink,
  Info,
  LoaderCircle,
  LogIn,
  LogOut,
  Radar,
  RefreshCw,
  ShieldCheck
} from "lucide-react";

import type {
  OnboardingCliAuthStepDto,
  OnboardingProviderCheckResponse,
  OnboardingProviderKind
} from "@jarv1s/shared";

import { testOnboardingProviderConnection } from "../api/client";
import { StepHeader } from "./onboarding-ui";

const CLI_LABELS: Record<string, { name: string; loginCommand: string }> = {
  anthropic: { name: "Claude", loginCommand: "claude login" },
  "openai-compatible": { name: "Codex", loginCommand: "codex login" },
  google: { name: "Antigravity", loginCommand: "agy" }
};

export function CliAuthStep(props: {
  readonly step: OnboardingCliAuthStepDto;
  readonly onRecheck: () => Promise<unknown> | void;
}) {
  const [checkingKind, setCheckingKind] = useState<OnboardingProviderKind | null>(null);
  const [results, setResults] = useState<
    Partial<Record<OnboardingProviderKind, OnboardingProviderCheckResponse>>
  >({});

  const checkProvider = async (kind: OnboardingProviderKind) => {
    setCheckingKind(kind);
    try {
      const result = await testOnboardingProviderConnection({ providerKind: kind });
      setResults((current) => ({ ...current, [kind]: result }));
    } catch {
      setResults((current) => ({ ...current, [kind]: { status: "error" } }));
    } finally {
      setCheckingKind(null);
    }
  };

  return (
    <section className="onb-step" aria-labelledby="onboarding-cli-title">
      <StepHeader
        eyebrow="Step 2 · Your provider"
        title="Choose your AI provider."
        lede="Jarvis uses AI command-line tools on your computer. We automatically check what is installed so you can verify your connection below."
      />
      <div className="onb-scan">
        <span className="onb-scan__ic">
          <Radar size={18} aria-hidden="true" />
        </span>
        <div className="onb-scan__main">
          <div className="onb-scan__t">
            Detected {props.step.providers.filter((provider) => provider.cliPresent).length} of{" "}
            {props.step.providers.length} assistants installed
          </div>
        </div>
        <button
          className="jds-btn jds-btn--secondary jds-btn--sm"
          type="button"
          onClick={props.onRecheck}
        >
          <RefreshCw size={14} aria-hidden="true" />
          Re-scan
        </button>
      </div>
      <div className="onb-clis">
        {props.step.providers.map((provider) => {
          const label = CLI_LABELS[provider.kind] ?? {
            name: provider.kind,
            loginCommand: provider.kind
          };
          const isChecking = checkingKind === provider.kind;
          const result = results[provider.kind];
          const ready = result?.status === "ready";
          const needsLogin = result !== undefined && result.status !== "ready";
          return (
            <div
              className={`onb-cli${provider.cliPresent ? "" : " is-off"}${ready ? " is-sel" : ""}`}
              key={provider.kind}
            >
              <span className="onb-cli__radio">
                {ready ? <CircleCheck size={12} strokeWidth={3} aria-hidden="true" /> : null}
              </span>
              <div className="onb-cli__body">
                <div className="onb-cli__top">
                  <span className="onb-cli__name">{label.name}</span>
                  <span className="onb-cli__cmd">{label.loginCommand.split(" ")[0]}</span>
                  <span className="onb-cli__sp" />
                  <span className={`onb-detect onb-detect--${provider.cliPresent ? "on" : "off"}`}>
                    {provider.cliPresent ? (
                      <CircleCheck size={13} aria-hidden="true" />
                    ) : (
                      <CircleDashed size={13} aria-hidden="true" />
                    )}
                    {provider.cliPresent ? "Installed" : "Not installed"}
                  </span>
                </div>
                {provider.cliPresent ? (
                  <div className="onb-auth">
                    {result === undefined && !isChecking ? (
                      <>
                        <button
                          className="onb-auth__btn"
                          type="button"
                          disabled={checkingKind !== null}
                          onClick={() => void checkProvider(provider.kind)}
                        >
                          <LogIn size={14} aria-hidden="true" /> Test login
                        </button>
                        <span className="onb-auth__note">
                          Checks your sign-in status on your computer.
                        </span>
                      </>
                    ) : null}
                    {isChecking ? (
                      <span className="onb-auth__testing">
                        <LoaderCircle className="spin" size={14} aria-hidden="true" /> Testing
                        login…
                      </span>
                    ) : null}
                    {ready ? (
                      <>
                        <span className="onb-auth__res onb-auth__res--in">
                          <ShieldCheck size={14} aria-hidden="true" /> Signed in &amp; ready
                        </span>
                        <button
                          className="onb-auth__re"
                          type="button"
                          disabled={checkingKind !== null}
                          onClick={() => void checkProvider(provider.kind)}
                        >
                          Re-test
                        </button>
                      </>
                    ) : null}
                    {needsLogin ? (
                      <div className="onb-auth__outwrap">
                        <div className="onb-auth__outhd">
                          <span className="onb-auth__res onb-auth__res--out">
                            <LogOut size={14} aria-hidden="true" /> Not signed in
                          </span>
                          <button
                            className="onb-auth__re"
                            type="button"
                            disabled={checkingKind !== null}
                            onClick={() => void checkProvider(provider.kind)}
                          >
                            Re-test
                          </button>
                        </div>
                        <div className="onb-auth__hint">{providerCheckMessage(result)}</div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="onb-cli__install">
                    <span className="onb-cli__installhint">
                      <Info size={14} aria-hidden="true" />
                      Not detected. Install it, then run <code>{label.loginCommand}</code>.
                    </span>
                    <a
                      className="onb-cli__guide"
                      href="https://github.com"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Install guide <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function providerCheckMessage(result: OnboardingProviderCheckResponse): string {
  if (result.message) return result.message;
  switch (result.status) {
    case "ready":
      return "Connection ready.";
    case "needs_login":
      return "Log in on your computer, then test again.";
    case "not_installed":
      return "Install the AI tool on your computer first.";
    case "multiplexer_unavailable":
      return "Ensure the terminal multiplexer is running, then test again.";
    case "error":
      return "Connection test failed. Try again.";
  }
}
