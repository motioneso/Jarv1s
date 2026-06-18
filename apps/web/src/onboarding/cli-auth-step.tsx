import { useState } from "react";
import { LoaderCircle } from "lucide-react";

import type {
  OnboardingCliAuthStepDto,
  OnboardingProviderCheckResponse,
  OnboardingProviderKind
} from "@jarv1s/shared";

import { testOnboardingProviderConnection } from "../api/client";

const CLI_LABELS: Record<string, { name: string; loginCommand: string }> = {
  anthropic: { name: "Claude", loginCommand: "claude login" },
  "openai-compatible": { name: "Codex", loginCommand: "codex login" },
  google: { name: "Gemini", loginCommand: "gemini" }
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
      <p className="onb-eyebrow">Step 2 · The assistant</p>
      <h1 id="onboarding-cli-title" className="onb-title">
        Connect the assistant I’ll run.
      </h1>
      <p className="onb-lede">
        Jarvis works through an AI command-line tool on your computer. I can see whether it is
        installed. Only you can sign in to it, there on the host.
      </p>
      <ul className="onboarding-cli-list onb-status-list">
        {props.step.providers.map((provider) => {
          const label = CLI_LABELS[provider.kind] ?? {
            name: provider.kind,
            loginCommand: provider.kind
          };
          const isChecking = checkingKind === provider.kind;
          const result = results[provider.kind];
          return (
            <li className="onb-cli-provider" key={provider.kind}>
              <div>
                <strong>{label.name}</strong>{" "}
                {provider.cliPresent ? (
                  <span className="form-hint">
                    detected — sign in on the host if you have not already
                  </span>
                ) : (
                  <span className="form-hint">
                    not detected. Install it, then run <code>{label.loginCommand}</code>
                  </span>
                )}
                {result ? (
                  <div className="form-hint onb-provider-check-result">
                    {providerCheckMessage(result)}
                  </div>
                ) : null}
              </div>
              <button
                className="ghost-button onb-mini-button"
                type="button"
                disabled={checkingKind !== null || !provider.cliPresent}
                onClick={() => void checkProvider(provider.kind)}
              >
                {isChecking ? <LoaderCircle className="spin" size={16} /> : null}
                {provider.cliPresent ? "Test connection" : "Install first"}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="onb-recheck">
        <p>
          These checks confirm the program is installed on the host. Sign-in still happens in that
          tool&apos;s own terminal session.
        </p>
        <button className="ghost-button" type="button" onClick={props.onRecheck}>
          Re-check host
        </button>
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
      return "Sign in on the host, then test again.";
    case "not_installed":
      return "Install the CLI on the host first.";
    case "multiplexer_unavailable":
      return "Start the selected multiplexer, then test again.";
    case "error":
      return "Connection test failed. Try again.";
  }
}
