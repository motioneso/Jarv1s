/* Representative sample data for settings surfaces whose backend is not yet
   wired (see 2026-06-14 settings design handoff — items marked 🔌). Shapes
   mirror the design kit's fake data; values are illustrative. These power the
   click-through of Active sessions, the data-export job, the server-side vault
   chooser, and the per-module setting sub-views until the endpoints land. */

/* --------------------------------------------------------- Active sessions */

export type SessionDeviceKind = "laptop" | "desktop" | "phone" | "tablet";

export interface SampleSession {
  readonly id: string;
  readonly device: string;
  readonly kind: SessionDeviceKind;
  readonly browser: string;
  readonly os: string;
  readonly where: string;
  readonly ip: string;
  readonly last: string;
  readonly current: boolean;
}

// Intentionally empty — we don't show fabricated session data. Real rows arrive once
// the list-sessions endpoint exists (BACKEND-TODO). Type kept to document the shape.
export const SAMPLE_SESSIONS: readonly SampleSession[] = [];

/* ----------------------------------------------------- Server filesystem */

export interface ServerRoot {
  readonly name: string;
  readonly label: string;
  readonly writable: boolean;
  readonly note?: string;
}

export interface ServerNode {
  readonly name: string;
  readonly type: "dir" | "file";
  readonly mdCount?: number;
}

export interface ServerFs {
  readonly roots: readonly ServerRoot[];
  readonly tree: Readonly<Record<string, readonly ServerNode[]>>;
}

// Intentionally empty — no fabricated host filesystem. Populated by a real host-fs
// listing API when it exists (BACKEND-TODO). Types kept to document the shape.
export const SERVER_FS: ServerFs = { roots: [], tree: {} };

export const DEFAULT_VAULT = {
  linked: false,
  folder: "",
  mount: "",
  fileCount: 0,
  writable: false
};

export interface VaultBehavior {
  readonly k: string;
  readonly name: string;
  readonly desc: string;
  readonly on: boolean;
}

export const VAULT_BEHAVIORS: readonly VaultBehavior[] = [
  {
    k: "context",
    name: "Use for context & answers",
    desc: "Read your notes to ground answers and the briefing in what you already know.",
    on: true
  },
  {
    k: "surface",
    name: "Surface relevant notes",
    desc: "Bring up a note when it relates to what you're doing today.",
    on: true
  },
  {
    k: "capture",
    name: "Capture tasks from notes",
    desc: "Turn unchecked to-dos in your notes into tasks.",
    on: false
  },
  {
    k: "writeback",
    name: "Write notes back",
    desc: "Let Jarvis append summaries or notes to your folder.",
    on: false
  }
];

/* ------------------------------------------------- Per-module settings */

export interface BriefingSection {
  readonly k: string;
  readonly name: string;
  readonly desc: string;
  readonly on: boolean;
}

export interface BriefingsSettings {
  readonly morningTime: string;
  readonly eveningOn: boolean;
  readonly eveningTime: string;
  readonly depth: "brief" | "full";
  readonly readAloud: boolean;
  readonly sections: readonly BriefingSection[];
}

export const DEFAULT_BRIEFINGS: BriefingsSettings = {
  morningTime: "06:30",
  eveningOn: true,
  eveningTime: "21:00",
  depth: "full",
  readAloud: false,
  sections: [
    {
      k: "calendar",
      name: "Today's calendar",
      desc: "Your events, and the gaps Jarvis is protecting.",
      on: true
    },
    {
      k: "priorities",
      name: "Priorities",
      desc: "The handful of things that matter most today.",
      on: true
    },
    {
      k: "email",
      name: "Email needing a reply",
      desc: "Threads flagged as needing you today.",
      on: true
    },
    {
      k: "wellness",
      name: "Wellness check-in",
      desc: "A gentle read on capacity before the day starts.",
      on: true
    },
    { k: "weather", name: "Weather", desc: "A one-line look at the day ahead.", on: false }
  ]
};

export interface ChatSettings {
  readonly length: "concise" | "balanced" | "thorough";
  readonly suggestions: boolean;
  readonly voice: boolean;
  readonly crossSession: boolean;
  readonly streaming: boolean;
}

export const DEFAULT_CHAT: ChatSettings = {
  length: "balanced",
  suggestions: true,
  voice: false,
  crossSession: true,
  streaming: true
};

export type NotificationSensitivity = "quiet" | "balanced" | "proactive";

export interface NotificationType {
  readonly k: string;
  readonly name: string;
  readonly desc: string;
  readonly on: boolean;
}

export interface NotificationsSettings {
  readonly sensitivity: NotificationSensitivity;
  readonly channels: { readonly app: boolean; readonly push: boolean; readonly email: boolean };
  readonly types: readonly NotificationType[];
}

export const DEFAULT_NOTIFICATIONS: NotificationsSettings = {
  sensitivity: "balanced",
  channels: { app: true, push: true, email: false },
  types: [
    {
      k: "commitments",
      name: "Commitment reminders",
      desc: "When something you committed to is coming due.",
      on: true
    },
    {
      k: "calendar",
      name: "Calendar changes",
      desc: "New invites, moved meetings and conflicts.",
      on: true
    },
    { k: "email", name: "Email flags", desc: "A thread Jarvis thinks needs you today.", on: true },
    {
      k: "wellness",
      name: "Wellness nudges",
      desc: "Gentle check-ins — never about productivity.",
      on: true
    },
    {
      k: "modules",
      name: "Module alerts",
      desc: "Finance, knowledge and other module signals.",
      on: false
    }
  ]
};

export const NOTIFICATION_SENSITIVITY_HINT: Record<NotificationSensitivity, string> = {
  quiet: "Only what's genuinely urgent. Everything else waits for your briefing.",
  balanced: "The default. Timely nudges, without the noise.",
  proactive: "Jarvis speaks up early and often. Best when you want maximum coverage."
};
