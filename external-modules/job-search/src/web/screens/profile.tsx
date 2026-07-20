// #1197: Park Press profile + approved resume metadata. Resume content is
// deliberately ignored even though resume.get returns it; editing stays in
// the assistant and every untyped profile field is parsed defensively.
import { h, type ReactNodeLike } from "../runtime";
import { useToolQuery } from "../store";
import { EmptyState, outcomeGate } from "../states";
import { whenLabel } from "../format";
import { Eyebrow, SectionHead, Strap } from "../kit";
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
  | {
      status: "ok";
      revisionId: string;
      kind: string;
      createdAt: string;
      critiqueSummary?: string;
      evidence?: unknown[];
    };

function stringValues(fields: Record<string, unknown>, key: string): string[] {
  const value = fields[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim() !== "")
    .slice(0, 8);
}

function textValue(fields: Record<string, unknown>, key: string): string | null {
  const value = fields[key];
  if (typeof value === "string" && value.trim() !== "") return value;
  const values = stringValues(fields, key);
  return values.length > 0 ? values.join(" · ") : null;
}

function compensationValue(fields: Record<string, unknown>): string | null {
  const value = fields["compensation"];
  if (typeof value === "string" && value.trim() !== "") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const currency = typeof record["currency"] === "string" ? record["currency"].toUpperCase() : "";
  const minimum =
    typeof record["minimum"] === "number"
      ? record["minimum"]
      : typeof record["minimum"] === "string"
        ? Number(record["minimum"])
        : Number.NaN;
  if (!/^[A-Z]{3}$/.test(currency) || !Number.isFinite(minimum) || minimum <= 0) return null;
  const amount = Math.round(minimum)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${currency} ${amount}`;
}

function AssistantButton(props: {
  label: string;
  prompt: string;
  hostActions: HostActions;
  quiet?: boolean;
}): ReactNodeLike {
  return (
    <button
      type="button"
      className={`jds-btn ${props.quiet ? "jds-btn--quiet" : "jds-btn--secondary"} jds-btn--sm`}
      onClick={() => props.hostActions.openAssistant({ starterPrompt: props.prompt })}
    >
      {props.label}
    </button>
  );
}

function FileGlyph(): ReactNodeLike {
  return (
    <span className="jsm-file-glyph" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M6 2h8l4 4v16H6z" />
        <path d="M14 2v5h5M9 13h6M9 17h6" />
      </svg>
    </span>
  );
}

function Field(props: { label: string; children?: unknown }): ReactNodeLike {
  return (
    <div className="jsm-field">
      <span className="jds-eyebrow">{props.label}</span>
      {props.children}
    </div>
  );
}

export function ProfileView(props: {
  profile: ProfileResult;
  resume: ResumeResult;
  hostActions: HostActions;
}): ReactNodeLike {
  const active = props.profile.active;
  const fields = active?.fields ?? {};
  const titles = stringValues(fields, "targetTitles");
  const locations = stringValues(fields, "locations");
  const dealbreakers = stringValues(fields, "dealbreakers");
  return (
    <div className="jsm-screen">
      <section aria-labelledby="jsm-profile-page-title">
        <Eyebrow tone="gold">What Jarvis searches on</Eyebrow>
        <h2 id="jsm-profile-page-title" className="jsm-display jsm-display--compact">
          Profile &amp; resume
        </h2>
        <Strap />
        <p className="jsm-hero__copy">
          This is the lens every match is scored through. Edit it in a conversation — I&apos;ll
          draft the change and you approve it.
        </p>
      </section>
      <div className="jsm-rule" aria-hidden="true" />
      <div className="jsm-profile-grid">
        <section aria-labelledby="jsm-resume-title">
          <SectionHead
            trailing={
              props.resume.status === "ok" ? (
                <span className="jds-badge jds-badge--forest">Approved</span>
              ) : undefined
            }
          >
            <span id="jsm-resume-title">Resume</span>
          </SectionHead>
          {props.resume.status !== "ok" ? (
            <EmptyState
              title="No resume yet"
              body="Share your resume with Jarvis to get a critique and an approved revision."
              action={
                <AssistantButton
                  label="Share with Jarvis"
                  prompt="Let's work on my resume. Help me add and review the current version."
                  hostActions={props.hostActions}
                />
              }
            />
          ) : (
            <div className="jds-card jsm-profile-card">
              <div className="jsm-profile-card__head">
                <FileGlyph />
                <div>
                  <h3>Approved resume</h3>
                  <p className="jds-eyebrow">{`rev · ${props.resume.revisionId.slice(0, 8)} · ${props.resume.kind}`}</p>
                </div>
              </div>
              <div className="jsm-field-grid">
                <Field label="Approved">
                  <span>{whenLabel(props.resume.createdAt)}</span>
                </Field>
                <Field label="Confirmed claims">
                  <span>{props.resume.evidence?.length ?? 0}</span>
                </Field>
              </div>
              {props.resume.critiqueSummary ? (
                <div className="jsm-critique">
                  <span className="jds-eyebrow">Latest critique</span>
                  <p>{props.resume.critiqueSummary}</p>
                </div>
              ) : null}
              <div className="jsm-button-row">
                <AssistantButton
                  label="Refine with Jarvis"
                  prompt="Let's refine my approved resume. Show me proposed changes before saving."
                  hostActions={props.hostActions}
                />
                <AssistantButton
                  label="Revisions"
                  prompt="Show me my resume revision history."
                  hostActions={props.hostActions}
                  quiet
                />
              </div>
            </div>
          )}
        </section>
        <section aria-labelledby="jsm-search-profile-title">
          <SectionHead
            trailing={
              active ? (
                <span className="jds-eyebrow">{`Updated ${whenLabel(active.createdAt)}`}</span>
              ) : undefined
            }
          >
            <span id="jsm-search-profile-title">Search profile</span>
          </SectionHead>
          {!active ? (
            <EmptyState
              title="No profile yet"
              body="Build your search profile in a conversation with Jarvis."
              action={
                <AssistantButton
                  label="Build with Jarvis"
                  prompt="Let's build my job search profile: titles, locations, compensation, and dealbreakers."
                  hostActions={props.hostActions}
                />
              }
            />
          ) : (
            <div className="jds-card jsm-profile-fields">
              <Field label="Target titles">
                <div className="jsm-pill-row">
                  {titles.map((title) => (
                    <span key={title} className="jds-chip">
                      {title}
                    </span>
                  ))}
                </div>
              </Field>
              <div className="jsm-field-grid">
                <Field label="Seniority">
                  <span>{textValue(fields, "seniority") ?? "Not set"}</span>
                </Field>
                <Field label="Comp floor">
                  <span className="jsm-numeric">{compensationValue(fields) ?? "Not set"}</span>
                </Field>
              </div>
              <Field label="Locations">
                <div className="jsm-pill-row">
                  {locations.map((location) => (
                    <span key={location} className="jds-chip">
                      {location}
                    </span>
                  ))}
                </div>
              </Field>
              <Field label="Work mode">
                <span>{textValue(fields, "remotePreference") ?? "Not set"}</span>
              </Field>
              <Field label="Dealbreakers">
                <div className="jsm-pill-row">
                  {dealbreakers.map((dealbreaker) => (
                    <span key={dealbreaker} className="jsm-dealbreaker">
                      {dealbreaker}
                    </span>
                  ))}
                </div>
              </Field>
              <AssistantButton
                label="Update with Jarvis"
                prompt="Let's update my job search profile. Show me the proposed revision before approval."
                hostActions={props.hostActions}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export function ProfileScreen(props: { hostActions: HostActions }): ReactNodeLike {
  // Independent reads start together; resume never waits for profile.
  const profile = useToolQuery<ProfileResult & Record<string, unknown>>("job-search.profile.get");
  const resume = useToolQuery<Record<string, unknown>>("job-search.resume.get");
  return outcomeGate(
    profile,
    (profileResult) => {
      if (resume.status === "loading") {
        return outcomeGate(resume, () => null, { loadingLabel: "Loading resume" });
      }
      if (resume.outcome.kind !== "ok") {
        return outcomeGate(resume, () => null, { loadingLabel: "Loading resume" });
      }
      return (
        <ProfileView
          profile={profileResult}
          resume={resume.outcome.result as ResumeResult}
          hostActions={props.hostActions}
        />
      );
    },
    { loadingLabel: "Loading profile" }
  );
}
