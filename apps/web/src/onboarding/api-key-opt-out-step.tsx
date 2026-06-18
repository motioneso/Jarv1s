import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, Lock } from "lucide-react";

import { listAiProviders } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { FootNote, OptionCard, StepHeader } from "./onboarding-ui";

export function ApiKeyOptOutStep(props: { readonly onSkipStep: () => void }) {
  const [assistant, setAssistant] = useState<"shared" | "personal">("shared");
  // Client-side apiKeyOptOut.done derivation (module isolation): the AI module's own public
  // endpoint is the source of truth — settings/onboarding NEVER reads an AI table directly.
  // "done" means the member has already configured at least one of their own AI providers
  // (i.e. opted IN to a personal key); a member who uses the shared assistant simply skips.
  const providersQuery = useQuery({
    queryKey: queryKeys.ai.providers,
    queryFn: () => listAiProviders(),
    retry: false
  });
  const done = (providersQuery.data?.providers.length ?? 0) > 0;

  return (
    <section className="onb-step" aria-labelledby="member-apikey-title">
      <StepHeader
        eyebrow="Step 1 · Your assistant"
        title="I already work, out of the box."
        lede={
          done
            ? "You’ve added your own AI provider. You can manage it in Settings anytime."
            : "I run on a shared setup, so there’s nothing for you to install. If you’d rather I use your own AI key — for your own usage and limits — you can add one. Most people don’t need to."
        }
      />
      <div className="onb-opts">
        <OptionCard
          selected={assistant === "shared"}
          onClick={() => setAssistant("shared")}
          name="Use the shared setup"
          mono="recommended"
          desc="I run on the shared assistant. Simplest, and already working."
        />
        <OptionCard
          selected={assistant === "personal"}
          onClick={() => setAssistant("personal")}
          name="Add a personal key"
          mono="optional"
          desc="Bring your own AI key, kept private to you. You can add it in Settings."
        />
      </div>
      {assistant === "personal" ? (
        <div className="onb-keyfield">
          <label className="onb-keyfield__lbl" htmlFor="member-personal-ai-key">
            <span className="ic">
              <KeyRound size={14} aria-hidden="true" />
            </span>
            Personal AI key
          </label>
          <input
            id="member-personal-ai-key"
            type="text"
            placeholder="sk-…  (kept private to you)"
            spellCheck={false}
          />
          <div className="onb-keyfield__hint">
            Optional. You can paste it now or add it later under Settings → Assistant. Nothing is
            shared with anyone else.
          </div>
        </div>
      ) : null}
      <FootNote icon={<Lock size={15} aria-hidden="true" />}>
        You can switch later in Settings. Either way, your conversations stay private to you.
      </FootNote>
    </section>
  );
}
