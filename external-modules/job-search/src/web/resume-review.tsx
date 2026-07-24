import { h, type ReactNodeLike } from "./runtime";
import { critiqueSections, reviewSummary, type ResumeReview } from "./resume-review-model";

export function ResumeReviewCard(props: {
  readonly review: ResumeReview;
  readonly busy?: boolean;
  readonly approved?: string;
  readonly message?: string;
  readonly onApprove: () => void;
  readonly onRevise: () => void;
}): ReactNodeLike {
  const sections = critiqueSections(props.review);
  return (
    <article className="jsn-critique-card" aria-label="Résumé review draft">
      <div className="jsn-critique-card__eyebrow">Read your résumé · draft</div>
      <p className="jsn-critique-card__summary">{reviewSummary(props.review)}</p>

      <div className="jsn-critique-card__columns">
        <ReviewList
          className="jsn-review-list jsn-review-list--strengths"
          title="Strengths I’ll cite"
          items={props.review.strengths.map((strength) => (
            <li className="jsn-review-list__item" key={`${strength.text}:${strength.evidence}`}>
              <span>{strength.text}</span>
              <small>Source: “{strength.evidence}”</small>
            </li>
          ))}
          empty="Nothing to overstate yet."
        />
        <ReviewList
          className="jsn-review-list jsn-review-list--gaps"
          title="I’d source before citing"
          items={props.review.gaps.map((gap) => (
            <li className="jsn-review-list__item" key={`${gap.text}:${gap.evidence ?? ""}`}>
              <span className="jsn-go-learn-chip">{gap.text}</span>
              {gap.evidence ? <small>Résumé says: “{gap.evidence}”</small> : null}
            </li>
          ))}
          empty="No unsupported claims surfaced."
        />
      </div>

      {sections.length > 0 ? (
        <section className="jsn-critique-sections" aria-label="Critique by section">
          <h3>Critique</h3>
          {sections.map((section) => (
            <div className="jsn-critique-section" key={section.section}>
              <h4>{section.section}</h4>
              <ul>
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      {props.review.revisions.length > 0 ? (
        <section className="jsn-revisions" aria-label="Tracked changes">
          <h3>Tracked changes</h3>
          {props.review.revisions.map((revision) => (
            <div className="jsn-revision" key={`${revision.section}:${revision.before}`}>
              <span className="jsn-revision__section">{revision.section}</span>
              <del>{revision.before}</del>
              <ins>{revision.after}</ins>
              <small>Source: “{revision.evidence}”</small>
            </div>
          ))}
        </section>
      ) : null}

      {props.message ? (
        <p className="jsn-critique-card__message" role="status">
          {props.message}
        </p>
      ) : null}
      <div className="jsn-critique-card__actions">
        <button
          className="jds-btn jds-btn--primary"
          type="button"
          disabled={props.busy || Boolean(props.approved)}
          onClick={props.onApprove}
        >
          <span aria-hidden="true">✓</span> {props.approved ?? "Looks right — use it"}
        </button>
        <button
          className="jds-btn jds-btn--quiet"
          type="button"
          disabled={props.busy}
          onClick={props.onRevise}
        >
          <span aria-hidden="true">▱</span> Let’s refine it
        </button>
      </div>
    </article>
  );
}

function ReviewList(props: {
  readonly className: string;
  readonly title: string;
  readonly items: readonly ReactNodeLike[];
  readonly empty: string;
}): ReactNodeLike {
  return (
    <section className={props.className}>
      <h3>{props.title}</h3>
      <ul>
        {props.items.length > 0 ? (
          props.items
        ) : (
          <li className="jsn-review-list__empty">{props.empty}</li>
        )}
      </ul>
    </section>
  );
}
