import { runQueue } from "./api";
import { INLINE_CONTROL_SLOTS, PROFILE_FIELDS } from "./onboarding-model";
import { resumeReviewFromResult, reviewClaimCount, type ResumeReview } from "./resume-review-model";
import { ResumeReviewCard } from "./resume-review";
import { h, useCallback, useEffect, useRef, useState, type ReactNodeLike } from "./runtime";

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

type SurfaceRecord = {
  readonly kind: string;
  readonly toolName?: string;
  readonly outcome?: "executed" | "denied" | "error" | "allowed";
  readonly result?: Record<string, unknown>;
};

export type AssistantSurfaceHandle = {
  readonly Surface: (props: SurfaceProps) => ReactNodeLike;
  readonly seedOnboarding: () => Promise<{ ok: boolean }>;
  readonly seedComposer: (draft: string) => void;
  readonly submitTurn: (input: {
    readonly text: string;
    readonly controlContext?: Record<string, unknown>;
    readonly attachmentIds?: readonly string[];
  }) => Promise<void>;
  readonly uploadAttachment: (file: File) => Promise<{
    readonly id: string;
    readonly fileName: string;
    readonly sizeBytes: number;
  }>;
  readonly subscribeRecords: (listener: (records: readonly SurfaceRecord[]) => void) => () => void;
};

function ProfileAside(props: { readonly resumeStatus: string }): ReactNodeLike {
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
            {field.id === "resume" ? (
              <span className="jsn-profile-field__value">{props.resumeStatus}</span>
            ) : (
              <span className="jsn-profile-field__skeleton" aria-label={`${field.label} loading`} />
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}

function ResumeIntakeControl(props: {
  readonly busy: boolean;
  readonly notice?: string;
  readonly onUpload: (file: File) => void;
  readonly onPaste: () => void;
  readonly onInterview: () => void;
}): ReactNodeLike {
  return (
    <div className="jsn-control-slots" aria-label="Job Search controls">
      <div className="jsn-control-slot jsn-control-slot--filled" data-control-slot="resume-intake">
        <div className="jsn-resume-intake">
          <div>
            <span className="jsn-eyebrow">Résumé</span>
            <p>Start with the work you want your next search to build from.</p>
          </div>
          <div className="jsn-resume-intake__actions">
            <label className="jds-btn jds-btn--secondary">
              Upload résumé
              <input
                className="jsn-visually-hidden"
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                disabled={props.busy}
                onChange={(event: { currentTarget: HTMLInputElement }) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) props.onUpload(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <button
              className="jds-btn jds-btn--quiet"
              type="button"
              disabled={props.busy}
              onClick={props.onPaste}
            >
              Paste résumé
            </button>
            <button
              className="jds-btn jds-btn--quiet"
              type="button"
              disabled={props.busy}
              onClick={props.onInterview}
            >
              Build from interview
            </button>
          </div>
          {props.busy ? (
            <span className="jsn-resume-intake__status">Reading your résumé…</span>
          ) : null}
          {props.notice ? (
            <span className="jsn-resume-intake__status" role="status">
              {props.notice}
            </span>
          ) : null}
        </div>
      </div>
      {INLINE_CONTROL_SLOTS.filter((slot) => slot !== "resume-intake").map((slot) => (
        <div className="jsn-control-slot" data-control-slot={slot} key={slot} />
      ))}
    </div>
  );
}

export function OnboardingScreen(props: {
  assistantSurface?: AssistantSurfaceHandle;
}): ReactNodeLike {
  const seeded = useRef(false);
  const [review, setReview] = useState<ResumeReview | null>(null);
  const [resumeStatus, setResumeStatus] = useState("Not yet");
  const [intakeMode, setIntakeMode] = useState<"paste" | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [approval, setApproval] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!props.assistantSurface || seeded.current) return;
    seeded.current = true;
    void props.assistantSurface.seedOnboarding();
  }, [props.assistantSurface]);

  const handledRecords = useRef(new Set<string>());
  useEffect(() => {
    const surface = props.assistantSurface;
    if (!surface) return;
    return surface.subscribeRecords((records) => {
      for (const record of records) {
        if (record.kind !== "action_result" || !record.toolName || !record.outcome) continue;
        const recordKey = `${record.toolName}:${JSON.stringify(record.result ?? {})}`;
        if (handledRecords.current.has(recordKey)) continue;
        handledRecords.current.add(recordKey);
        if (record.outcome !== "executed" && record.outcome !== "allowed") {
          setBusy(false);
          setNotice("I couldn't finish that résumé step. Try again in a moment.");
          continue;
        }
        if (record.toolName === "job-search.resume.intake") {
          setResumeStatus("Draft — reviewing");
          void surface
            .submitTurn({
              text: "Review the saved résumé and return the grounded review artifact.",
              controlContext: { step: "resume", action: "critique" }
            })
            .catch(() => {
              setBusy(false);
              setNotice("I couldn't start the résumé review. Try again in a moment.");
            });
          continue;
        }
        if (record.toolName !== "job-search.resume.critique") continue;
        const nextReview = resumeReviewFromResult(record.result);
        if (!nextReview) {
          setBusy(false);
          setResumeStatus("Draft");
          setNotice("I couldn't format that review. Try again in a moment.");
          continue;
        }
        const count = reviewClaimCount(nextReview);
        setBusy(false);
        setReview(nextReview);
        setResumeStatus(`Draft — ${count.verifiable}/${count.total} claims verifiable`);
      }
    });
  }, [props.assistantSurface]);

  const handleUpload = useCallback(
    async (file: File) => {
      if (!props.assistantSurface) return;
      if (!isResumeFile(file)) {
        setNotice("I can only read PDF or DOCX resumes. Try pasting it instead.");
        return;
      }
      setBusy(true);
      setNotice(undefined);
      setApproval(undefined);
      try {
        const attachment = await props.assistantSurface.uploadAttachment(file);
        await props.assistantSurface.submitTurn({
          text: attachment.fileName,
          attachmentIds: [attachment.id],
          controlContext: { step: "resume", action: "upload" }
        });
      } catch {
        setBusy(false);
        setNotice("I couldn't upload that file. Try again or paste the résumé here.");
      }
    },
    [props.assistantSurface]
  );

  const handleComposerText = useCallback(
    (text: string): "handled" | "send" => {
      if (intakeMode !== "paste" || !props.assistantSurface) return "send";
      setIntakeMode(null);
      setBusy(true);
      setNotice(undefined);
      void props.assistantSurface
        .submitTurn({ text, controlContext: { step: "resume", action: "paste" } })
        .catch(() => {
          setBusy(false);
          setNotice("I couldn't read that paste. Try again in a moment.");
        });
      return "handled";
    },
    [intakeMode, props.assistantSurface]
  );

  const approve = useCallback(async () => {
    if (!review) return;
    setBusy(true);
    setNotice(undefined);
    const result = await runQueue("job-search.resume-revise", "job-search.resume-revise", {
      revisionId: review.revisionId
    });
    setBusy(false);
    if (result.kind !== "queued" && result.kind !== "already-queued") {
      setNotice(
        result.kind === "error" ? result.message : "Resume approval is unavailable right now."
      );
      return;
    }
    const shortRevision = review.revisionId.slice(0, 8);
    setApproval(`Approved · rev ${shortRevision}`);
    setResumeStatus(`Approved · rev ${shortRevision}`);
    props.assistantSurface?.seedComposer(
      "Looks right — use this approved résumé and help me continue."
    );
  }, [props.assistantSurface, review]);

  const revise = useCallback(() => {
    props.assistantSurface?.seedComposer("Let’s refine this résumé review before I approve it.");
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
  const localRows = [
    {
      id: "job-search-resume-opener",
      role: "assistant" as const,
      content:
        "Let’s get your resume solid first. Share the experience you want your next search to build from."
    },
    ...(review
      ? [
          {
            id: `job-search-resume-review-${review.revisionId}`,
            role: "assistant" as const,
            content: (
              <ResumeReviewCard
                review={review}
                busy={busy}
                approved={approval}
                message={notice}
                onApprove={() => void approve()}
                onRevise={revise}
              />
            )
          }
        ]
      : [])
  ];
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
            localRows={localRows}
            activeControl={
              <ResumeIntakeControl
                busy={busy}
                notice={review ? undefined : notice}
                onUpload={(file) => void handleUpload(file)}
                onPaste={() => {
                  setIntakeMode("paste");
                  setNotice("Paste the résumé into the chat composer, then send it.");
                  props.assistantSurface?.seedComposer("");
                }}
                onInterview={() =>
                  props.assistantSurface?.seedComposer(
                    "Let’s build my résumé from an interview. Start with the work you want to carry forward."
                  )
                }
              />
            }
            composer={{
              placeholder: "Tell Jarvis about your experience…",
              onSubmitText: handleComposerText
            }}
          />
        </main>
        <ProfileAside resumeStatus={resumeStatus} />
      </div>
    </section>
  );
}

function isResumeFile(file: File): boolean {
  return (
    file.type === "application/pdf" ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    /\.(pdf|docx)$/i.test(file.name)
  );
}
