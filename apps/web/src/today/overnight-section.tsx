import { Badge, type BadgeTone } from "@moss/ui";

import type { FeedTone, TodayFeed } from "./feed-source";

const FEED_BADGE_TONE: Record<FeedTone, BadgeTone> = {
  pine: "forest",
  amber: "amber",
  steel: "steel",
  red: "red",
  neutral: "neutral"
};

export function OvernightSection(props: { readonly items: TodayFeed["overnight"] }) {
  return (
    <section className="jds-brief">
      <div className="jds-brief__head">
        <span className="jds-brief__kicker">Overnight</span>
      </div>
      <div className="jds-brief__title">What changed since last night</div>
      <div className="overnight">
        {props.items.map((item) => (
          <div className="overnight__row" key={item.tag + item.text}>
            <Badge tone={FEED_BADGE_TONE[item.tone]}>{item.tag}</Badge>
            <span className="tx">{item.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
