// external-modules/job-search/src/web/starter-drafts.ts
// JS-06 (#935): editable starter prompts for the #916 assistant handoff. The
// host sanitizer fail-closes above 1000 chars — keep these short, plain ASCII,
// and imperative so the user can edit before sending (never auto-submitted).
const STEP_DRAFTS: Record<string, string> = {
  resume_intake:
    "Let's start my job search onboarding. I'd like to share my current resume with you.",
  resume_critique: "Please walk me through your critique of my resume and what you'd improve.",
  resume_approval: "Let's review the latest resume revision together so I can approve it.",
  profile: "Let's build my job search profile: target titles, skills, locations, and preferences.",
  sources_schedule: "Help me pick job sources and set up a monitoring schedule.",
  review_enable: "Let's review my job search setup and enable monitoring."
};

const DONE_DRAFT = "Let's review my job search status and what to do next.";

export function starterDraftForStep(step: string): string {
  return STEP_DRAFTS[step] ?? DONE_DRAFT;
}

export const RESUME_DRAFT =
  "Let's work on my resume. Show me the latest revision and suggest improvements.";
export const PROFILE_DRAFT =
  "Let's update my job search profile: titles, skills, locations, and preferences.";
