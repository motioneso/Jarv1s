/*
 * PROTOTYPE — THROWAWAY. Not production code, not covered by tests, delete after the
 * UI question is settled. See apps/web/src/job-search-prototype/README.md.
 *
 * Fake data for the job-search UI prototype. Everything is in memory; nothing is fetched,
 * nothing is persisted. The shapes here are deliberately close to the designed records so
 * the variants exercise real states (degraded portal with a cause, empty profile, unscored
 * backlog) rather than only the happy path.
 */

/** The two axes. Never collapsed into one number — that ruling is load-bearing for the design. */
export interface MatchAxes {
  /** Can you do it, and would they plausibly want you. */
  readonly fit: number;
  /** Would you still want it a year in. This is the axis the whole product exists for. */
  readonly want: number;
}

export interface FakeMatch {
  readonly id: string;
  readonly title: string;
  readonly company: string;
  readonly location: string;
  readonly posted: string;
  readonly source: "Indeed" | "LinkedIn" | "freehire" | "Cascade Labs careers";
  readonly axes: MatchAxes;
  /** Why the model scored it this way — shown, never hidden behind a number. */
  readonly fitReason: string;
  readonly wantReason: string;
  /**
   * True when the posting does NOT match what the user asked for but the model thinks they
   * should look anyway. The recall case: "I've been in this world so long I have to stay
   * here — but it may not be the case."
   */
  readonly outsideFrame?: boolean;
  readonly state: "new" | "seen" | "dismissed";
  /** Unscored = crawled and stored, but the model has not read it yet (scoring backlog). */
  readonly unscored?: boolean;
}

export interface FakePortal {
  readonly id: string;
  readonly name: string;
  readonly status: "ok" | "degraded" | "disabled";
  readonly lastSuccess: string;
  /** Structured cause — never a bare "failed". Jarvis reads these fields too. */
  readonly cause?: {
    readonly kind: "rate_limited" | "login_required" | "parse_failed";
    readonly detail: string;
    readonly nextAttempt?: string;
  };
}

export interface FakeProfile {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly newCount: number;
  readonly totalCount: number;
  readonly schedule: string;
  readonly lastCrawl: string;
  /** A profile can exist before the conversation has produced criteria. */
  readonly state: "active" | "in_conversation" | "crawling";
  readonly resume: { readonly name: string; readonly updated: string; readonly version: number };
  readonly portals: readonly FakePortal[];
  readonly matches: readonly FakeMatch[];
}

const softwareEngineerMatches: readonly FakeMatch[] = [
  {
    id: "m1",
    title: "Staff Platform Engineer",
    company: "Cascade Labs",
    location: "Remote (US)",
    posted: "2 days ago",
    source: "freehire",
    axes: { fit: 91, want: 78 },
    fitReason:
      "Platform work on an internal developer platform, Postgres and TypeScript, team of nine. Your last four years map almost directly.",
    wantReason:
      "You said the part you liked least was being three layers from the people using the thing. This team sits with its users weekly, which is the right direction — but it is still internal tooling.",
    state: "new"
  },
  {
    id: "m2",
    title: "Forward Deployed Engineer",
    company: "Halden AI",
    location: "Remote (US), ~25% travel",
    posted: "yesterday",
    source: "LinkedIn",
    axes: { fit: 74, want: 94 },
    fitReason:
      "They want customer-facing engineering with real implementation depth. You have the architecture background; you have less recent hands-on ML.",
    wantReason:
      "This is the closest thing on the board to what you described wanting: sitting with a customer, building the thing, seeing it land. Travel is the open question.",
    outsideFrame: true,
    state: "new"
  },
  {
    id: "m3",
    title: "Senior Solution Architect",
    company: "Northgate Systems",
    location: "Hybrid — Denver",
    posted: "4 days ago",
    source: "Indeed",
    axes: { fit: 96, want: 41 },
    fitReason: "Near-identical to your last role. You would clear their bar without trying.",
    wantReason:
      "Same shape as the job you were in. You told me the ceiling there was the problem, not the work. Flagging the gap rather than ranking this first.",
    state: "new"
  },
  {
    id: "m4",
    title: "Developer Experience Lead",
    company: "Fernwood",
    location: "Remote (US)",
    posted: "6 days ago",
    source: "freehire",
    axes: { fit: 82, want: 71 },
    fitReason:
      "Tooling, docs, and internal advocacy. Strong overlap with the platform half of your history.",
    wantReason: "People-facing, which you want. Smaller company than you have worked in.",
    state: "seen"
  },
  {
    id: "m5",
    title: "Principal Engineer, Integrations",
    company: "Ostrom Health",
    location: "Remote (US)",
    posted: "1 week ago",
    source: "Indeed",
    axes: { fit: 88, want: 63 },
    fitReason:
      "Integration architecture at scale. Healthcare compliance experience is listed as nice-to-have.",
    wantReason:
      "You have not said much about healthcare either way. Worth a look before I weight it.",
    state: "seen"
  },
  {
    id: "m6",
    title: "Engineering Manager, Platform",
    company: "Brightline Freight",
    location: "Onsite — Chicago",
    posted: "3 days ago",
    source: "LinkedIn",
    axes: { fit: 0, want: 0 },
    fitReason: "",
    wantReason: "",
    state: "new",
    unscored: true
  }
];

export const FAKE_PROFILES: readonly FakeProfile[] = [
  {
    id: "swe",
    name: "Software Engineer",
    summary:
      "Platform and infrastructure, remote-first, senior or staff. Wants to be closer to users.",
    newCount: 4,
    totalCount: 38,
    schedule: "Every 6 hours",
    lastCrawl: "1 hour ago",
    state: "active",
    resume: { name: "Resume — platform.pdf", updated: "3 days ago", version: 4 },
    portals: [
      { id: "indeed", name: "Indeed", status: "ok", lastSuccess: "1 hour ago" },
      {
        id: "linkedin",
        name: "LinkedIn",
        status: "degraded",
        lastSuccess: "9 hours ago",
        cause: {
          kind: "rate_limited",
          detail: "LinkedIn returned 429 after page 8. Got 112 of an estimated 190 postings.",
          nextAttempt: "in 4 hours"
        }
      },
      { id: "freehire", name: "freehire", status: "ok", lastSuccess: "1 hour ago" },
      {
        id: "cascade",
        name: "Cascade Labs careers",
        status: "disabled",
        lastSuccess: "6 days ago",
        cause: {
          kind: "login_required",
          detail:
            "This board now requires an account before it will show postings. Jarvis stopped rather than sign in, so this portal is off until you say otherwise."
        }
      }
    ],
    matches: softwareEngineerMatches
  },
  {
    id: "fde",
    name: "Forward-Deployed AI Engineer",
    summary: "Customer-facing engineering at AI companies. Building with the people who use it.",
    newCount: 2,
    totalCount: 11,
    schedule: "Daily at 7am",
    lastCrawl: "5 hours ago",
    state: "active",
    resume: { name: "Resume — forward deployed.pdf", updated: "yesterday", version: 2 },
    portals: [
      { id: "indeed", name: "Indeed", status: "ok", lastSuccess: "5 hours ago" },
      { id: "linkedin", name: "LinkedIn", status: "ok", lastSuccess: "5 hours ago" },
      { id: "freehire", name: "freehire", status: "ok", lastSuccess: "5 hours ago" }
    ],
    matches: [
      {
        id: "f1",
        title: "Forward Deployed Engineer",
        company: "Halden AI",
        location: "Remote (US), ~25% travel",
        posted: "yesterday",
        source: "LinkedIn",
        axes: { fit: 74, want: 94 },
        fitReason: "Customer-facing engineering with implementation depth.",
        wantReason: "The closest thing on the board to what you described wanting.",
        state: "new"
      },
      {
        id: "f2",
        title: "Solutions Engineer, Enterprise",
        company: "Verity",
        location: "Remote (US)",
        posted: "3 days ago",
        source: "Indeed",
        axes: { fit: 86, want: 58 },
        fitReason: "Pre-sales heavy. You have done this shape of work before.",
        wantReason:
          "More selling than building. You said the building part is what you missed, so I am ranking this below Halden.",
        state: "new"
      }
    ]
  },
  {
    id: "new",
    name: "Product Engineering",
    summary: "",
    newCount: 0,
    totalCount: 0,
    schedule: "Not set",
    lastCrawl: "Never",
    state: "in_conversation",
    resume: { name: "", updated: "", version: 0 },
    portals: [],
    matches: []
  }
];

/** Lookup that never returns undefined, so the variants stay readable under
 * `noUncheckedIndexedAccess`. Falls back to the first fixture. */
export function profileById(id: string): FakeProfile {
  const found = FAKE_PROFILES.find((p) => p.id === id);
  if (found) return found;
  const first = FAKE_PROFILES[0];
  if (!first) throw new Error("prototype fixture list is empty");
  return first;
}

export interface FakeTurn {
  readonly role: "jarvis" | "you";
  readonly text: string;
}

/** The coaching conversation — a real conversation, not a wizard wearing chat clothing. */
export const FAKE_CONVERSATION: readonly FakeTurn[] = [
  {
    role: "jarvis",
    text: "Before we look at anything, I want to understand what you're actually after. You were at ServiceNow for a long stretch — when you think back over it, what was the part of the work you'd have kept if you could only keep one thing?"
  },
  {
    role: "you",
    text: "Honestly the customer sessions. Sitting in a room, figuring out what they actually needed, then going and building it."
  },
  {
    role: "jarvis",
    text: "And how much of your week was that, by the end?"
  },
  {
    role: "you",
    text: "Maybe a day a month. Most of it was architecture review and internal alignment."
  },
  {
    role: "jarvis",
    text: "That's worth sitting with. The thing you'd keep was about three percent of the job. I want to flag something before we go further — you've described your search to me as \"ServiceNow architect roles,\" but nothing you've told me about what you enjoy is specific to ServiceNow. It's specific to being close to the person with the problem. Those two searches return very different lists. Can I widen it and show you both?"
  }
];
