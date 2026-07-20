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
  type OnboardingSnapshot,
  type OnboardingPhase,
  type ProfileFields,
  type ProfileProgress,
  type ProfileSubstep,
  type SourceInfo
} from "./model";

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
  await handle.seedOnboarding();
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
    if (record.kind === "action_result" && record.actionRequestId && pending.has(record.actionRequestId)) {
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

export function JobsOnboarding(props: {
  readonly handle: AssistantSurfaceHandleMirror;
}): ReactNodeLike {
  const [outcome, setOutcome] = useState<BootstrapOutcome | null>(null);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!outcome) {
    return <LoadingState label="Loading job search setup" />;
  }

  const Surface = props.handle.Surface;
  return <Surface composer={{ placeholder: "Tell us more" }} />;
}
