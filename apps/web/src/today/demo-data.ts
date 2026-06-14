/*
 * Demo content for the Today / briefing layout.
 *
 * These sections (weather, overnight digest, sports desk, news desk) have NO
 * backend source yet — they're sample data so the full editorial layout is
 * visible and designable. Swap each for a real feed when it exists; the Today
 * page reads from here so the wiring point is obvious.
 */

export type WeatherIcon = "sun" | "cloud" | "cloud-sun" | "cloud-rain" | "cloud-snow" | "wind";
export type FeedTone = "pine" | "amber" | "steel" | "red" | "neutral";

export interface WeatherDay {
  readonly d: string;
  readonly icon: WeatherIcon;
  readonly tone: "amber" | "steel" | "slate";
  readonly hi: number;
  readonly lo: number;
  readonly note?: string;
}

export const DEMO_WEATHER: { readonly place: string; readonly days: readonly WeatherDay[] } = {
  place: "San Francisco",
  days: [
    { d: "Thu", icon: "sun", tone: "amber", hi: 68, lo: 54 },
    { d: "Fri", icon: "cloud-sun", tone: "steel", hi: 65, lo: 53 },
    { d: "Sat", icon: "cloud", tone: "slate", hi: 62, lo: 52, note: "AM fog" },
    { d: "Sun", icon: "cloud-rain", tone: "steel", hi: 59, lo: 51, note: "Showers" },
    { d: "Mon", icon: "cloud-sun", tone: "steel", hi: 64, lo: 52 },
    { d: "Tue", icon: "sun", tone: "amber", hi: 70, lo: 55 },
    { d: "Wed", icon: "sun", tone: "amber", hi: 72, lo: 56 }
  ]
};

export interface OvernightItem {
  readonly tone: FeedTone;
  readonly tag: string;
  readonly text: string;
}

export const DEMO_OVERNIGHT: readonly OvernightItem[] = [
  { tone: "pine", tag: "Calendar", text: "Your 9:30 moved to 11:00 — Sarah shifted the review." },
  {
    tone: "amber",
    tag: "At risk",
    text: "The lease reply is now overdue; I can draft something if you want."
  },
  {
    tone: "steel",
    tag: "Email",
    text: "Three newsletters filed overnight — nothing that needs you."
  }
];

export interface SportsItem {
  readonly team: string;
  readonly league: string;
  readonly headline: string;
  readonly score?: string;
  readonly detail?: string;
  readonly outcome?: "W" | "L" | "D";
  readonly kind: "game" | "news";
  readonly color: string;
}

export const DEMO_SPORTS: readonly SportsItem[] = [
  {
    team: "SF Giants",
    league: "MLB",
    outcome: "W",
    headline: "Giants edge the Dodgers in extras",
    score: "4–3 (F/10)",
    detail: "A pinch-hit single in the 10th sent the home crowd out happy.",
    kind: "game",
    color: "var(--steel)"
  },
  {
    team: "Liverpool",
    league: "EPL",
    outcome: "D",
    headline: "Liverpool held to a draw at Anfield",
    score: "1–1",
    kind: "game",
    color: "var(--red)"
  },
  {
    team: "Buffalo Bills",
    league: "NFL",
    headline: "Bills sign a veteran safety ahead of camp",
    kind: "news",
    color: "var(--steel)"
  }
];

export const DEMO_SPORTS_QUIET: readonly string[] = ["the Ducks", "San Diego FC"];

export interface NewsItem {
  readonly source: string;
  readonly title: string;
  readonly dek?: string;
  readonly meta: string;
}

export const DEMO_NEWS: readonly NewsItem[] = [
  {
    source: "Reuters",
    title: "Central bank holds rates steady, signals patience",
    dek: "Officials kept the benchmark unchanged and pointed to a cooling labor market.",
    meta: "Markets · 6 min read"
  },
  { source: "The Verge", title: "On-device assistant models get a quiet upgrade", meta: "2h ago" },
  { source: "Ars Technica", title: "A calmer approach to home automation", meta: "Yesterday" }
];

export interface InterestItem {
  readonly icon: "cpu" | "leaf" | "book";
  readonly title: string;
  readonly topic: string;
}

export const DEMO_INTERESTS: readonly InterestItem[] = [
  { icon: "cpu", title: "Local-first software keeps gaining momentum", topic: "Local-first" },
  { icon: "leaf", title: "Making the most of a small urban garden", topic: "Gardening" }
];
