// external-modules/job-search/src/web/screens/profile.tsx
// JS-06 (#935): compact approved-revision metadata only — full editing stays
// conversational (JS-03). Resume `content` is deliberately never rendered.
// All values render as React text children (external strings stay text).
import { h, type ReactNodeLike } from "../runtime";
import { useToolQuery } from "../store";
import { EmptyState, outcomeGate } from "../states";
import { whenLabel } from "../format";
import { PROFILE_DRAFT, RESUME_DRAFT } from "../starter-drafts";
import type { HostActions } from "../root";

export type ProfileResult = {
  status: string;
  active: null | {
    revisionId: string;
    createdAt: string;
    provenance: string;
    fields: Record<string, unknown>;
  };
  draftRevisionIds: string[];
};

export type ResumeResult =
  | { status: "question"; question?: string }
  | { status: "ok"; revisionId: string; kind: string; createdAt: string; critiqueSummary?: string };

function chipValues(fields: Record<string, unknown>, key: string): string[] {
  const value = fields[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").slice(0, 6);
}

function AssistantButton(props: {
  label: string;
  draft: string;
  hostActions: HostActions;
}): ReactNodeLike {
  return (
    <button
      type="button"
      className="jds-btn jds-btn--secondary jds-btn--sm"
      onClick={() => props.hostActions.openAssistant({ starterPrompt: props.draft })}
    >
      {props.label}
    </button>
  );
}

export function ProfileView(props: {
  profile: ProfileResult;
  resume: ResumeResult;
  hostActions: HostActions;
}): ReactNodeLike {
  const { profile, resume } = props;
  return (
    <div className="jsm-grid">
      <section className="jds-card jsm-state" aria-labelledby="jsm-resume-title">
        <span className="jds-eyebrow">Resume</span>
        <h2 id="jsm-resume-title">Approved resume</h2>
        {resume.status !== "ok" ? (
          <EmptyState
            title="No resume yet"
            body="Share your resume with Jarvis to get a critique and an approved revision."
            action={
              <AssistantButton
                label="Share with Jarvis"
                draft={RESUME_DRAFT}
                hostActions={props.hostActions}
              />
            }
          />
        ) : (
          <div className="jsm-stack">
            <dl className="jsm-meta">
              <dt className="jds-eyebrow">Revision</dt>
              <dd>{resume.revisionId.slice(0, 8)}</dd>
              <dt className="jds-eyebrow">Kind</dt>
              <dd>{resume.kind}</dd>
              <dt className="jds-eyebrow">Created</dt>
              <dd>{whenLabel(resume.createdAt)}</dd>
            </dl>
            {resume.critiqueSummary ? <p>{resume.critiqueSummary}</p> : null}
            <AssistantButton
              label="Refine with Jarvis"
              draft={RESUME_DRAFT}
              hostActions={props.hostActions}
            />
          </div>
        )}
      </section>
      <section className="jds-card jsm-state" aria-labelledby="jsm-profile-title">
        <span className="jds-eyebrow">Profile</span>
        <h2 id="jsm-profile-title">Search profile</h2>
        {!profile.active ? (
          <EmptyState
            title="No profile yet"
            body="Build your search profile in a conversation with Jarvis."
            action={
              <AssistantButton
                label="Build with Jarvis"
                draft={PROFILE_DRAFT}
                hostActions={props.hostActions}
              />
            }
          />
        ) : (
          <div className="jsm-stack">
            <dl className="jsm-meta">
              <dt className="jds-eyebrow">Source</dt>
              <dd>
                <span className="jds-badge jds-badge--outline">{profile.active.provenance}</span>
              </dd>
              <dt className="jds-eyebrow">Updated</dt>
              <dd>{whenLabel(profile.active.createdAt)}</dd>
            </dl>
            <div className="jsm-meta">
              {[
                ...chipValues(profile.active.fields, "targetTitles"),
                ...chipValues(profile.active.fields, "locations")
              ].map((value) => (
                <span key={value} className="jds-chip">
                  {value}
                </span>
              ))}
            </div>
            <AssistantButton
              label="Update with Jarvis"
              draft={PROFILE_DRAFT}
              hostActions={props.hostActions}
            />
          </div>
        )}
      </section>
    </div>
  );
}

export function ProfileScreen(props: { hostActions: HostActions }): ReactNodeLike {
  const profile = useToolQuery<ProfileResult & Record<string, unknown>>("job-search.profile.get");
  return outcomeGate(
    profile,
    (profileResult) => <ProfileResume profile={profileResult} hostActions={props.hostActions} />,
    { loadingLabel: "Loading profile" }
  );
}

function ProfileResume(props: { profile: ProfileResult; hostActions: HostActions }): ReactNodeLike {
  const resume = useToolQuery<Record<string, unknown>>("job-search.resume.get");
  if (resume.status === "loading") {
    return outcomeGate(resume, () => null, { loadingLabel: "Loading resume" });
  }
  // resume.get answers {status:"question"} when nothing is stored — that's the
  // authored empty state, not a degraded outcome, so bypass outcomeGate's
  // status:"error"-only degradation and pass it through.
  const outcome = resume.outcome;
  if (outcome.kind !== "ok") {
    return outcomeGate(resume, () => null, { loadingLabel: "Loading resume" });
  }
  return (
    <ProfileView
      profile={props.profile}
      resume={outcome.result as ResumeResult}
      hostActions={props.hostActions}
    />
  );
}
