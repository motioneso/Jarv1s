import { BookOpen, Cpu, FileText, Leaf, Newspaper } from "lucide-react";

import type { TodayFeed } from "./feed-source";

const INTEREST_ICONS = { cpu: Cpu, leaf: Leaf, book: BookOpen } as const;

export function NewsDesk(props: {
  readonly news: TodayFeed["news"];
  readonly interests: TodayFeed["interests"];
}) {
  const hero = props.news[0];
  const rest = props.news.slice(1);
  return (
    <section className="jds-brief">
      <div className="jds-brief__head">
        <span className="jds-brief__kicker">The desk</span>
      </div>
      <div className="jds-brief__title">News &amp; your interests</div>
      {hero ? (
        <div className="np-hero">
          <div className="np-photo np-photo--news">
            <div className="np-photo__ph">
              <Newspaper size={22} aria-hidden="true" />
              <span className="np-photo__cap">Story image</span>
            </div>
          </div>
          <div className="np-hero__body">
            <div className="np-kicker">{hero.source}</div>
            <h3 className="np-headline">{hero.title}</h3>
            {hero.dek ? <p className="np-dek">{hero.dek}</p> : null}
            <div className="np-meta">{hero.meta}</div>
          </div>
        </div>
      ) : null}
      <div className="np-list">
        {rest.map((n) => (
          <div className="np-row" key={n.title}>
            <div className="np-row__lead src">
              <FileText size={15} aria-hidden="true" />
            </div>
            <div className="np-row__main">
              <div className="np-row__title">{n.title}</div>
              <div className="np-row__sub">
                <span className="src">{n.source}</span> · {n.meta}
              </div>
            </div>
          </div>
        ))}
        {props.interests.map((n) => {
          const Ico = INTEREST_ICONS[n.icon];
          return (
            <div className="np-row" key={n.title}>
              <div className="np-row__lead src">
                <Ico size={15} aria-hidden="true" />
              </div>
              <div className="np-row__main">
                <div className="np-row__title">{n.title}</div>
                <div className="np-row__sub">
                  <span className="np-topic">Following · {n.topic}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
