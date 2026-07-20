// #1198: assistant surface orchestration + host first-run gate. Structural
// mirror types only — this module never imports apps/web/src/chat internals,
// so it must match the real AssistantSurfaceHandleV1/TranscriptRecord field
// names exactly (messageId/actionRequestId/toolName/outcome) for runtime
// objects flowing through the host boundary to actually match at runtime.
import { LoadingState } from "../../states";
import { invokeTool } from "../../api";
import { h, useEffect, useState, type ReactNodeLike } from "../../runtime";
import {
  derivePhase,
  expectedTools,
  parseCompensation,
  type OnboardingSnapshot,
  type OnboardingPhase,
  type ProfileFields,
  type ProfileProgress,
  type ProfileSubstep,
  type SourceInfo
} from "./model";
import {
  CritiqueCard,
  MultiControl,
  RESUME_ACCEPT,
  MAX_RESUME_BYTES,
  ResumeDropzone,
  SourcesControl,
  Summary
} from "./controls";

// job-search.profile.get returns the profile TAB's ProfileResult shape
// ({status, active:{fields}|null, draftRevisionIds}), not model.ts's
// ProfileProgress — map field presence to substep completion locally so
// derivePhase's cursor logic (owned by model.ts, Task 2) stays untouched.
function toProfileProgress(result: {
  readonly active: { readonly fields: Record<string, unknown> } | null;
}): ProfileProgress {
  const fields = (result.active?.fields ?? {}) as ProfileFields;
  const completed: ProfileSubstep[] = [];
  if ((fields.targetTitles ?? []).length) completed.push("titles");
  if (fields.compensation) completed.push("comp");
  if ((fields.remotePreference ?? []).length) completed.push("workmode");
  if ((fields.locations ?? []).length) completed.push("locations");
  if ((fields.dealbreakers ?? []).length) completed.push("dealbreakers");
  return { fields, completed };
}

export interface AssistantSurfaceViewPropsMirror {
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
  readonly typing?: boolean;
}

export interface AssistantSurfaceHandleMirror {
  readonly Surface: (props: AssistantSurfaceViewPropsMirror) => ReactNodeLike;
  seedOnboarding(): Promise<{ ok: boolean }>;
  submitTurn(input: {
    readonly text: string;
    readonly controlContext?: Record<string, unknown>;
    readonly attachmentIds?: readonly string[];
  }): Promise<void>;
  uploadAttachment(
    file: File
  ): Promise<{ readonly id: string; readonly fileName: string; readonly sizeBytes: number }>;
  subscribeRecords(listener: (records: readonly AssistantRecordMirror[]) => void): () => void;
}

export type AssistantRecordOutcome = "executed" | "denied" | "error" | "allowed";

export interface AssistantRecordMirror {
  readonly kind:
    | "user"
    | "thinking"
    | "tool"
    | "status"
    | "reply"
    | "error"
    | "action_request"
    | "action_result";
  readonly messageId?: string;
  readonly actionRequestId?: string;
  readonly toolName?: string;
  readonly outcome?: AssistantRecordOutcome;
}

export interface BootstrapSnapshot {
  readonly snapshot: OnboardingSnapshot;
  readonly resume: unknown;
  readonly sources: readonly SourceInfo[];
}

export type BootstrapOutcome =
  | { readonly kind: "ok"; readonly data: BootstrapSnapshot }
  | { readonly kind: "blocked"; readonly reason: string }
  | { readonly kind: "disabled" }
  | { readonly kind: "error"; readonly message: string };

async function bootstrapRead<T extends Record<string, unknown>>(
  name: string
): Promise<
  | { readonly kind: "ok"; readonly result: T }
  | { readonly kind: "blocked"; readonly reason: string }
  | { readonly kind: "disabled" }
  | { readonly kind: "error"; readonly message: string }
> {
  const outcome = await invokeTool<T>(name);
  if (outcome.kind === "ok") return { kind: "ok", result: outcome.result };
  if (outcome.kind === "disabled") return { kind: "disabled" };
  if (outcome.kind === "blocked") return { kind: "blocked", reason: outcome.reason };
  return { kind: "error", message: outcome.message };
}

export async function bootstrapOnboarding(
  handle: AssistantSurfaceHandleMirror
): Promise<BootstrapOutcome> {
  // Unhandled here, this rejection would leave JobsOnboarding's `outcome` state at
  // null forever (permanent loading spinner) instead of surfacing the error state.
  try {
    await handle.seedOnboarding();
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof Error ? error.message : "Failed to seed onboarding."
    };
  }
  const [onboarding, profile, resume, sources] = await Promise.all([
    bootstrapRead<OnboardingSnapshot["onboarding"] & Record<string, unknown>>(
      "job-search.onboarding.get-state"
    ),
    bootstrapRead<{ active: { fields: Record<string, unknown> } | null } & Record<string, unknown>>(
      "job-search.profile.get"
    ),
    bootstrapRead<Record<string, unknown>>("job-search.resume.get"),
    bootstrapRead<{ sources: readonly SourceInfo[] } & Record<string, unknown>>(
      "job-search.sources.list"
    )
  ]);
  for (const read of [onboarding, profile, resume, sources]) {
    if (read.kind === "disabled") return { kind: "disabled" };
  }
  for (const read of [onboarding, profile, resume, sources]) {
    if (read.kind === "blocked") return { kind: "blocked", reason: read.reason };
  }
  for (const read of [onboarding, profile, resume, sources]) {
    if (read.kind === "error") return { kind: "error", message: read.message };
  }
  if (
    onboarding.kind !== "ok" ||
    profile.kind !== "ok" ||
    resume.kind !== "ok" ||
    sources.kind !== "ok"
  ) {
    return { kind: "error", message: "Unexpected onboarding bootstrap state." };
  }
  return {
    kind: "ok",
    data: {
      snapshot: {
        onboarding: onboarding.result,
        profileProgress: toProfileProgress(profile.result)
      },
      resume: resume.result,
      sources: sources.result.sources ?? []
    }
  };
}

const PROFILE_TITLES: Readonly<Record<ProfileSubstep, string>> = {
  titles: "titles",
  comp: "comp",
  workmode: "workmode",
  locations: "locations",
  dealbreakers: "dealbreakers"
};

export function buildProfileSubmit(
  phase: ProfileSubstep,
  values: Partial<ProfileFields>
): { readonly text: string; readonly controlContext: Record<string, unknown> } {
  const text = summarizeProfileValues(phase, values);
  return {
    text,
    controlContext: {
      step: "profile",
      action: PROFILE_TITLES[phase],
      values
    }
  };
}

function summarizeProfileValues(phase: ProfileSubstep, values: Partial<ProfileFields>): string {
  if (phase === "titles") return (values.targetTitles ?? []).join(" · ");
  if (phase === "comp") {
    return values.compensation ? `$${values.compensation.minimum}` : "";
  }
  if (phase === "workmode") return (values.remotePreference ?? []).join(" · ");
  if (phase === "locations") return (values.locations ?? []).join(" · ");
  return (values.dealbreakers ?? []).join(" · ");
}

export function buildComposerSubmit(
  phase: OnboardingPhase,
  handle: AssistantSurfaceHandleMirror
): (text: string) => "handled" {
  const step: OnboardingPhase | "profile" = isProfileSubstep(phase) ? "profile" : phase;
  return (text: string) => {
    void handle.submitTurn({ text, controlContext: { step, action: "freeform" } });
    return "handled";
  };
}

function isProfileSubstep(phase: OnboardingPhase): phase is ProfileSubstep {
  return phase in PROFILE_TITLES;
}

export interface AdvanceResult {
  readonly pendingIds: ReadonlySet<string>;
  readonly retry: boolean;
}

export function advanceOnDurableEvent(
  records: readonly AssistantRecordMirror[],
  pendingIds: ReadonlySet<string>,
  activePhase: OnboardingPhase,
  onAdvance: () => void
): AdvanceResult {
  const expected = new Set(expectedTools(activePhase));
  const pending = new Set(pendingIds);
  let retry = false;

  for (const record of records) {
    if (
      record.kind === "action_request" &&
      record.messageId &&
      record.toolName &&
      expected.has(record.toolName)
    ) {
      pending.add(record.messageId);
      continue;
    }
    if (
      record.kind === "action_result" &&
      record.actionRequestId &&
      pending.has(record.actionRequestId)
    ) {
      if (record.outcome === "executed") {
        pending.delete(record.actionRequestId);
        onAdvance();
        continue;
      }
      if (record.outcome === "denied" || record.outcome === "error") {
        pending.delete(record.actionRequestId);
        retry = true;
      }
    }
  }

  return { pendingIds: pending, retry };
}

const PHASE_ORDER: readonly OnboardingPhase[] = [
  "resume_intake",
  "resume_critique",
  "resume_approval",
  "titles",
  "comp",
  "workmode",
  "locations",
  "dealbreakers",
  "sources_schedule",
  "done"
];

// job-search.resume.get's response shape (worker/handlers/resume.ts) —
// mirrored locally for the same structural-boundary reason as the file
// header: this module never imports worker internals.
interface ResumeReadResult {
  readonly critiqueSummary?: string;
  readonly evidence?: readonly { readonly claimText: string }[];
}

interface LocalRow {
  readonly id: string;
  readonly role: "assistant" | "user";
  readonly content: ReactNodeLike;
}

function phaseRows(phase: OnboardingPhase, data: BootstrapSnapshot, dueTime: string): LocalRow[] {
  const row = (index: number, content: ReactNodeLike): LocalRow => ({
    id: `${phase}-${index}`,
    role: "assistant",
    content
  });
  switch (phase) {
    case "resume_intake":
      return [
        row(
          0,
          "I'll get your job search set up — should take a couple of minutes, and you can change any of it later just by asking."
        ),
        row(
          1,
          "Let's start with your resume. Drop it in and I'll read it: I'll pull out the strengths I can actually stand behind and store an approved copy to score matches against. I never apply on your behalf."
        )
      ];
    case "resume_critique":
      return [];
    case "resume_approval": {
      const resume = data.resume as ResumeReadResult;
      return [
        row(
          0,
          <CritiqueCard
            summary={resume.critiqueSummary ?? ""}
            strengths={(resume.evidence ?? []).map((evidence) => evidence.claimText)}
            cautions={[]}
          />
        )
      ];
    }
    case "titles":
      return [
        row(
          0,
          "Good. From your resume, here are the titles I'd track. Keep the ones that fit, drop what doesn't, add anything I missed."
        )
      ];
    case "comp":
      return [
        row(
          0,
          "What's your base comp floor? Below this I won't waste your time surfacing anything."
        )
      ];
    case "workmode":
      return [row(0, "And how do you want to work?")];
    case "locations":
      return [
        row(
          0,
          "Where should I look? Add any regions or cities — I'll take remote as global unless you tell me otherwise."
        )
      ];
    case "dealbreakers":
      return [
        row(
          0,
          "Last thing about the role itself — anything that's an automatic no? A match that trips any of these gets filtered out before it reaches you."
        )
      ];
    case "sources_schedule":
      return [
        row(
          0,
          "Now the sources. I'll check these boards every morning — they're read-only public APIs, so I read postings and score them but never submit anything. Adjust the boards or the run time."
        )
      ];
    case "done":
      return [
        row(
          0,
          `That's everything I need. Monitoring is on and your first run is queued for ${dueTime} — I'll scan, score against your profile, and bring the credible matches into your morning briefing.`
        ),
        row(1, "You can change any of this later just by telling me. Ready when you are.")
      ];
  }
}

function buildLocalRows(
  phase: OnboardingPhase,
  data: BootstrapSnapshot,
  dueTime: string
): LocalRow[] {
  const upTo = PHASE_ORDER.indexOf(phase);
  return PHASE_ORDER.slice(0, upTo + 1).flatMap((step) => phaseRows(step, data, dueTime));
}

const PROFILE_SEED_DEFAULTS: Readonly<
  Record<
    ProfileSubstep,
    {
      readonly options: readonly string[];
      readonly initial?: readonly string[];
      readonly inferred?: readonly string[];
      readonly addPlaceholder?: string;
      readonly cta: string;
      readonly skip?: string;
      readonly min?: number;
    }
  >
> = {
  titles: {
    options: ["Staff Product Designer", "Principal Designer", "Design Engineer"],
    initial: ["Staff Product Designer", "Principal Designer"],
    inferred: ["Design Engineer"],
    addPlaceholder: "Add a title",
    cta: "Track these titles",
    min: 1
  },
  comp: {
    options: ["$175k", "$195k", "$215k"],
    addPlaceholder: "Enter an amount",
    cta: "Set comp floor",
    min: 1
  },
  workmode: {
    options: ["Remote-first", "Hybrid ok", "On-site ok"],
    cta: "Continue",
    min: 1
  },
  locations: {
    options: ["Remote — US", "San Francisco, CA"],
    initial: ["Remote — US"],
    addPlaceholder: "Add a location",
    cta: "Search these",
    min: 1
  },
  dealbreakers: {
    options: ["On-site 5 days/week", "Below comp floor", "No equity"],
    initial: ["On-site 5 days/week", "Below comp floor"],
    addPlaceholder: "Add a dealbreaker",
    cta: "Set dealbreakers",
    skip: "None of these"
  }
};

function profileSubstepValue(fields: ProfileFields, substep: ProfileSubstep): readonly string[] {
  if (substep === "titles") return fields.targetTitles ?? [];
  if (substep === "comp") return fields.compensation ? [`$${fields.compensation.minimum}`] : [];
  if (substep === "workmode") return fields.remotePreference ?? [];
  if (substep === "locations") return fields.locations ?? [];
  return fields.dealbreakers ?? [];
}

function buildProfileControl(
  substep: ProfileSubstep,
  data: BootstrapSnapshot,
  handle: AssistantSurfaceHandleMirror
): ReactNodeLike {
  const seed = PROFILE_SEED_DEFAULTS[substep];
  const known = profileSubstepValue(data.snapshot.profileProgress.fields, substep);
  const submitValues = (values: readonly string[]): Partial<ProfileFields> => {
    if (substep === "titles") return { targetTitles: values };
    if (substep === "comp") {
      const compensation = values[0] ? parseCompensation(values[0]) : null;
      return compensation ? { compensation } : {};
    }
    if (substep === "workmode") return { remotePreference: values };
    if (substep === "locations") return { locations: values };
    return { dealbreakers: values };
  };
  return (
    <MultiControl
      options={seed.options}
      initial={known.length ? known : seed.initial}
      inferred={seed.inferred}
      addPlaceholder={seed.addPlaceholder}
      cta={seed.cta}
      skip={seed.skip}
      min={seed.min}
      onSubmit={(values) => {
        void handle.submitTurn(buildProfileSubmit(substep, submitValues(values)));
      }}
    />
  );
}

interface ResumeIntakeLocal {
  readonly error: string | null;
  readonly showPaste: boolean;
  readonly setError: (value: string | null) => void;
  readonly setShowPaste: (value: boolean) => void;
}

function isAcceptedResumeFile(file: File): boolean {
  if (RESUME_ACCEPT.split(",").includes(file.type)) return true;
  return /\.(pdf|docx)$/i.test(file.name);
}

function buildResumeIntakeControl(
  handle: AssistantSurfaceHandleMirror,
  local: ResumeIntakeLocal
): ReactNodeLike {
  const rejectFile = (message: string) => {
    local.setError(message);
    local.setShowPaste(true);
  };
  return (
    <ResumeDropzone
      showPaste={local.showPaste}
      error={local.error}
      onFile={async (file) => {
        if (!isAcceptedResumeFile(file)) {
          rejectFile("I can only read PDF or DOCX resumes.");
          return;
        }
        if (file.size > MAX_RESUME_BYTES) {
          rejectFile("That file's over 5 MB — try a smaller export or paste the text instead.");
          return;
        }
        try {
          const uploaded = await handle.uploadAttachment(file);
          await handle.submitTurn({
            text: uploaded.fileName,
            attachmentIds: [uploaded.id],
            controlContext: { step: "resume_intake", action: "upload", fileName: uploaded.fileName }
          });
        } catch {
          rejectFile("I couldn't read that file — try again or paste the text instead.");
        }
      }}
      onPaste={(text) => {
        void handle.submitTurn({
          text,
          controlContext: { step: "resume_intake", action: "paste" }
        });
      }}
    />
  );
}

function buildActiveControl(
  phase: OnboardingPhase,
  data: BootstrapSnapshot,
  handle: AssistantSurfaceHandleMirror,
  local: ResumeIntakeLocal & {
    readonly dueTime: string;
    readonly setDueTime: (value: string) => void;
  }
): ReactNodeLike {
  if (phase === "resume_intake") return buildResumeIntakeControl(handle, local);
  if (phase === "resume_critique") return null;
  if (phase === "resume_approval") {
    return (
      <div className="jsm-button-row">
        <button
          type="button"
          className="jds-btn jds-btn--primary jds-btn--sm"
          onClick={() =>
            void handle.submitTurn({
              text: "Looks right — use it",
              controlContext: { step: "resume_approval", action: "approve" }
            })
          }
        >
          Looks right — use it
        </button>
        <button
          type="button"
          className="jds-btn jds-btn--ghost jds-btn--sm"
          onClick={() =>
            void handle.submitTurn({
              text: "Let's refine it",
              controlContext: { step: "resume_approval", action: "deny" }
            })
          }
        >
          Let's refine it
        </button>
      </div>
    );
  }
  if (
    phase === "titles" ||
    phase === "comp" ||
    phase === "workmode" ||
    phase === "locations" ||
    phase === "dealbreakers"
  ) {
    return buildProfileControl(phase, data, handle);
  }
  if (phase === "sources_schedule") {
    return (
      <SourcesControl
        sources={data.sources}
        initialRunTime="07:00"
        onSubmit={(selection) => {
          local.setDueTime(selection.dueTime);
          const names = selection.boards.map((board) => board.adapterId).join(" · ");
          void handle.submitTurn({
            text: `${names} · ${selection.dueTime}`,
            controlContext: {
              step: "sources_schedule",
              action: "schedule",
              boards: selection.boards,
              dueTime: selection.dueTime
            }
          });
        }}
      />
    );
  }
  return (
    <Summary
      runTime={local.dueTime}
      onContinue={() => window.location.reload()}
      onReset={() =>
        void handle.submitTurn({
          text: "Start over",
          controlContext: { step: "done", action: "reset" }
        })
      }
    />
  );
}

export function JobsOnboarding(props: {
  readonly handle: AssistantSurfaceHandleMirror;
}): ReactNodeLike {
  const [outcome, setOutcome] = useState<BootstrapOutcome | null>(null);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [dueTime, setDueTime] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    bootstrapOnboarding(props.handle).then((result) => {
      if (!cancelled) setOutcome(result);
    });
    const unsubscribe = props.handle.subscribeRecords((records) => {
      if (!outcome || outcome.kind !== "ok") return;
      const phase = derivePhase(outcome.data.snapshot);
      const result = advanceOnDurableEvent(records, pendingIds, phase, () => {
        bootstrapOnboarding(props.handle).then((next) => {
          if (!cancelled) setOutcome(next);
        });
      });
      setPendingIds(result.pendingIds);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  if (!outcome) {
    return <LoadingState label="Loading job search setup" />;
  }

  const Surface = props.handle.Surface;
  if (outcome.kind !== "ok") {
    return <Surface composer={{ placeholder: "Tell us more" }} />;
  }

  const phase = derivePhase(outcome.data.snapshot);
  const resolvedDueTime = dueTime ?? "07:00";
  return (
    <Surface
      localRows={buildLocalRows(phase, outcome.data, resolvedDueTime)}
      activeControl={buildActiveControl(phase, outcome.data, props.handle, {
        error: resumeError,
        showPaste,
        setError: setResumeError,
        setShowPaste,
        dueTime: resolvedDueTime,
        setDueTime
      })}
      composer={{
        placeholder: "Tell us more",
        onSubmitText: buildComposerSubmit(phase, props.handle)
      }}
      typing={phase === "resume_critique"}
    />
  );
}
