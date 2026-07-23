// #1232 — layout and type only; color values live in the host token layer.
export const MODULE_STYLES = `
.jsn-root { max-width: 78rem; margin: 0 auto; padding: var(--space-5) var(--space-4) var(--space-8); color: var(--text); font-family: var(--font-sans); }
.jsn-root h1, .jsn-root h2 { margin: 0; color: var(--text); font-family: var(--font-display); letter-spacing: var(--tracking-tight); }
.jsn-root h1 { font-size: clamp(var(--text-3xl), 4vw, var(--text-5xl)); line-height: var(--leading-tight); }
.jsn-root h2 { font-size: var(--text-xl); line-height: var(--leading-snug); }
.jsn-eyebrow, .jsn-new-since, .jsn-profile-card__status { font-family: var(--font-sans); font-variant-numeric: tabular-nums; letter-spacing: var(--tracking-caps); text-transform: uppercase; }
.jsn-eyebrow { color: var(--text-muted); font-size: var(--text-2xs); font-weight: var(--weight-bold); }
.jsn-landing-state { display: grid; gap: var(--space-5); }
.jsn-hero { display: grid; align-content: center; gap: var(--space-5); min-height: min(34rem, 62vh); max-width: 48rem; padding: var(--space-8) 0; }
.jsn-hero p { max-width: 38rem; margin: 0; color: var(--text-muted); font-size: var(--text-lg); line-height: var(--leading-relaxed); }
.jsn-landing-heading { display: flex; align-items: end; justify-content: space-between; gap: var(--space-4); }
.jsn-profile-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: var(--space-4); }
.jsn-profile-card { display: grid; gap: var(--space-3); min-height: 10rem; padding: var(--space-5); border: var(--border-w) solid var(--border); border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--shadow-sm); }
.jsn-profile-card__topline { display: flex; align-items: center; justify-content: space-between; }
.jsn-profile-card__status { margin: 0; color: var(--text-muted); font-size: var(--text-2xs); }
.jsn-new-since { display: inline-flex; width: fit-content; padding: var(--space-1) var(--space-2); color: var(--gold-ink); background: var(--gold-soft); font-size: var(--text-2xs); font-weight: var(--weight-bold); }
.jsn-run-state { width: .5rem; height: .5rem; border-radius: 999px; background: var(--forest); }
.jsn-skeleton { display: block; background: var(--surface-3); border-radius: var(--radius-sm); }
.jsn-skeleton--title { width: min(24rem, 72%); height: var(--text-5xl); }
.jsn-skeleton--line { width: min(34rem, 90%); height: var(--text-lg); }
.jsn-profile-card--skeleton { min-height: 10rem; }
.jsn-skeleton--card-title { width: 68%; height: var(--text-xl); }
.jsn-skeleton--card-line { width: 44%; height: var(--text-sm); }
.jsn-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.jsn-onboarding-grid { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(18rem, .75fr); align-items: start; gap: var(--space-6); }
.jsn-conversation-column { display: grid; gap: var(--space-5); min-width: 0; }
.jsn-conversation-heading { display: grid; gap: var(--space-2); }
.jsn-conversation-heading p { max-width: 38rem; margin: 0; color: var(--text-muted); }
.jsn-profile-aside { position: sticky; top: var(--space-5); display: grid; gap: var(--space-5); padding: var(--space-5); border: var(--border-w) solid var(--border); border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--shadow-sm); }
.jsn-profile-aside__heading { display: grid; gap: var(--space-2); }
.jsn-profile-fields { display: grid; gap: var(--space-1); }
.jsn-profile-field { display: grid; grid-template-columns: minmax(0, 1fr) minmax(5rem, .75fr); align-items: center; gap: var(--space-3); min-height: 2.75rem; border-bottom: var(--border-w) solid var(--border-subtle); }
.jsn-profile-field__label { color: var(--text-muted); font-size: var(--text-sm); }
.jsn-profile-field__skeleton { display: block; height: var(--text-sm); background: var(--surface-3); border-radius: var(--radius-sm); }
.jsn-profile-field__value { color: var(--text); font-size: var(--text-2xs); font-variant-numeric: tabular-nums; text-align: right; }
.jsn-control-slots { display: grid; gap: var(--space-2); width: 100%; }
.jsn-control-slot { min-height: var(--space-2); }
.jsn-control-slot--filled { min-height: 0; }
.jsn-resume-intake { display: grid; gap: var(--space-3); padding: var(--space-4); border: var(--border-w) solid var(--border); border-radius: var(--radius-md); background: var(--surface-2); }
.jsn-resume-intake p { margin: var(--space-1) 0 0; color: var(--text-muted); font-size: var(--text-sm); }
.jsn-resume-intake__actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.jsn-resume-intake__status { color: var(--text-muted); font-size: var(--text-sm); }
.jsn-onboarding-error { display: grid; gap: var(--space-3); max-width: 38rem; padding: var(--space-7) 0; }
.jsn-onboarding-error p { margin: 0; color: var(--text-muted); }
.jsn-critique-card { display: grid; gap: var(--space-4); padding: var(--space-4) var(--space-5); border: 1px dashed color-mix(in srgb, var(--gold) 55%, transparent); border-radius: var(--radius-md); background: color-mix(in srgb, var(--gold) 4%, var(--surface)); color: var(--ink); }
.jsn-critique-card__eyebrow, .jsn-revision__section { color: var(--gold-strong); font-size: var(--text-2xs); font-variant-numeric: tabular-nums; font-weight: var(--weight-bold); letter-spacing: var(--tracking-caps); text-transform: uppercase; }
.jsn-critique-card__summary { margin: 0; font-size: var(--text-sm); line-height: var(--leading-relaxed); text-wrap: pretty; }
.jsn-critique-card__columns { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); }
.jsn-review-list, .jsn-critique-sections, .jsn-revisions { display: grid; gap: var(--space-2); }
.jsn-review-list h3, .jsn-critique-sections h3, .jsn-revisions h3 { margin: 0; font-family: var(--font-sans); font-size: var(--text-sm); letter-spacing: normal; }
.jsn-review-list--strengths h3 { color: var(--accent); }
.jsn-review-list--gaps h3 { color: var(--gold-strong); }
.jsn-review-list ul, .jsn-critique-section ul { display: grid; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
.jsn-review-list__item { position: relative; display: grid; gap: var(--space-1); padding-left: var(--space-4); font-size: var(--text-sm); }
.jsn-review-list__item::before { position: absolute; top: .45rem; left: .15rem; width: .3rem; height: .3rem; border-radius: 999px; background: var(--accent); content: ""; }
.jsn-review-list--gaps .jsn-review-list__item::before { background: var(--amber); }
.jsn-review-list small, .jsn-revision small { color: var(--text-muted); font-size: var(--text-2xs); line-height: var(--leading-normal); }
.jsn-review-list__empty { color: var(--text-muted); font-size: var(--text-sm); }
.jsn-go-learn-chip { display: inline-flex; width: fit-content; padding: var(--space-1) var(--space-2); border: var(--border-w) solid var(--amber); border-radius: var(--radius-sm); color: var(--amber); font-size: var(--text-2xs); }
.jsn-critique-sections { padding-top: var(--space-3); border-top: var(--border-w) solid var(--border-subtle); }
.jsn-critique-section { display: grid; gap: var(--space-1); }
.jsn-critique-section h4 { margin: 0; color: var(--text-muted); font-family: var(--font-sans); font-size: var(--text-2xs); font-variant-numeric: tabular-nums; letter-spacing: var(--tracking-caps); text-transform: uppercase; }
.jsn-critique-section li { color: var(--text); font-size: var(--text-sm); }
.jsn-revisions { padding-top: var(--space-3); border-top: var(--border-w) solid var(--border-subtle); }
.jsn-revision { display: grid; gap: var(--space-1); padding: var(--space-2) 0; }
.jsn-revision del { color: var(--ink-3); text-decoration-thickness: var(--border-w); }
.jsn-revision ins { color: var(--accent); text-decoration: none; }
.jsn-critique-card__message { margin: 0; color: var(--text-muted); font-size: var(--text-sm); }
.jsn-critique-card__actions { display: flex; flex-wrap: wrap; gap: var(--space-2); padding-top: var(--space-2); }
@media (max-width: 56rem) { .jsn-onboarding-grid { grid-template-columns: 1fr; } .jsn-profile-aside { position: static; } }
@media (max-width: 44rem) { .jsn-landing-heading { align-items: start; flex-direction: column; } }
@media (max-width: 38rem) { .jsn-critique-card__columns { grid-template-columns: 1fr; } }
`;
