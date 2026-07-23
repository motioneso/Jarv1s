import { h, useEffect, useRef, type ReactNodeLike } from "./runtime";
import { INLINE_CONTROL_SLOTS, PROFILE_FIELDS } from "./onboarding-model";

type SurfaceProps = {
  readonly localRows?: readonly {
    readonly id: string;
    readonly role: "assistant" | "user";
    readonly content: ReactNodeLike;
  }[];
  readonly activeControl?: ReactNodeLike;
  readonly composer?: {
    readonly placeholder?: string;
    readonly onSubmitText?: (text: string) => "handled" | "send";
  };
};

export type AssistantSurfaceHandle = {
  readonly Surface: (props: SurfaceProps) => ReactNodeLike;
  readonly seedOnboarding: () => Promise<{ ok: boolean }>;
};

function ProfileAside(): ReactNodeLike {
  return (
    <aside className="jsn-profile-aside" aria-labelledby="jsn-profile-title">
      <div className="jsn-profile-aside__heading">
        <span className="jsn-eyebrow">Live profile</span>
        <h2 id="jsn-profile-title">Building your profile</h2>
      </div>
      <div className="jsn-profile-fields">
        {PROFILE_FIELDS.map((field) => (
          <div className="jsn-profile-field" key={field.id}>
            <span className="jsn-profile-field__label">{field.label}</span>
            <span className="jsn-profile-field__skeleton" aria-label={`${field.label} loading`} />
          </div>
        ))}
      </div>
    </aside>
  );
}

function EmptyControlSlots(): ReactNodeLike {
  return (
    <div className="jsn-control-slots" aria-label="Job Search controls">
      {INLINE_CONTROL_SLOTS.map((slot) => (
        <div className="jsn-control-slot" data-control-slot={slot} key={slot} />
      ))}
    </div>
  );
}

export function OnboardingScreen(props: {
  assistantSurface?: AssistantSurfaceHandle;
}): ReactNodeLike {
  const seeded = useRef(false);
  useEffect(() => {
    if (!props.assistantSurface || seeded.current) return;
    seeded.current = true;
    void props.assistantSurface.seedOnboarding();
  }, [props.assistantSurface]);

  if (!props.assistantSurface) {
    return (
      <section className="jsn-onboarding-error" role="alert">
        <span className="jsn-eyebrow">Conversation unavailable</span>
        <h1>Job Search needs a newer Jarvis host.</h1>
        <p>Update the host app to continue.</p>
      </section>
    );
  }

  const Surface = props.assistantSurface.Surface;
  return (
    <section className="jsn-onboarding" aria-labelledby="jsn-onboarding-title">
      <div className="jsn-onboarding-grid">
        <main className="jsn-conversation-column">
          <header className="jsn-conversation-heading">
            <span className="jsn-eyebrow">Step 01 · Start with the resume</span>
            <h1 id="jsn-onboarding-title">Let’s get your resume solid first.</h1>
            <p>Your profile takes shape from the conversation, one grounded detail at a time.</p>
          </header>
          <Surface
            localRows={[
              {
                id: "job-search-resume-opener",
                role: "assistant",
                content:
                  "Let’s get your resume solid first. Share the experience you want your next search to build from."
              }
            ]}
            activeControl={<EmptyControlSlots />}
            composer={{
              placeholder: "Tell Jarvis about your experience…",
              onSubmitText: () => "send"
            }}
          />
        </main>
        <ProfileAside />
      </div>
    </section>
  );
}
