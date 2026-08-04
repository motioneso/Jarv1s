import type { FeedTone, TodayFeed } from "./feed-source";

const FEED_BADGE: Record<FeedTone, string> = {
  pine: "jds-badge--forest",
  amber: "jds-badge--amber",
  steel: "jds-badge--steel",
  red: "jds-badge--red",
  neutral: "jds-badge--neutral"
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
            <span className={`jds-badge ${FEED_BADGE[item.tone]}`}>{item.tag}</span>
            <span className="tx">{item.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
