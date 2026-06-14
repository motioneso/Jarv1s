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

export interface WeatherFeed {
  readonly place: string;
  readonly days: readonly WeatherDay[];
}

export interface OvernightItem {
  readonly tone: FeedTone;
  readonly tag: string;
  readonly text: string;
}

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

export interface NewsItem {
  readonly source: string;
  readonly title: string;
  readonly dek?: string;
  readonly meta: string;
}

export interface InterestItem {
  readonly icon: "cpu" | "leaf" | "book";
  readonly title: string;
  readonly topic: string;
}

export interface TodayFeed {
  readonly weather: WeatherFeed | null;
  readonly overnight: readonly OvernightItem[];
  readonly sports: {
    readonly items: readonly SportsItem[];
    readonly quietTeams: readonly string[];
  };
  readonly news: readonly NewsItem[];
  readonly interests: readonly InterestItem[];
}

export function createEmptyTodayFeed(): TodayFeed {
  return {
    weather: null,
    overnight: [],
    sports: { items: [], quietTeams: [] },
    news: [],
    interests: []
  };
}

export function isTodayFeedEmpty(feed: TodayFeed): boolean {
  return (
    feed.weather === null &&
    feed.overnight.length === 0 &&
    feed.sports.items.length === 0 &&
    feed.sports.quietTeams.length === 0 &&
    feed.news.length === 0 &&
    feed.interests.length === 0
  );
}
