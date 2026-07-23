// #1232 — layout and type only; color values live in the host token layer.
export const MODULE_STYLES = `
.jsn-root { max-width: 78rem; margin: 0 auto; padding: var(--space-5) var(--space-4) var(--space-8); color: var(--text); font-family: var(--font-sans); }
.jsn-root h1, .jsn-root h2 { margin: 0; color: var(--text); font-family: var(--font-display); letter-spacing: var(--tracking-tight); }
.jsn-root h1 { font-size: clamp(var(--text-3xl), 4vw, var(--text-5xl)); line-height: var(--leading-tight); }
.jsn-root h2 { font-size: var(--text-xl); line-height: var(--leading-snug); }
.jsn-eyebrow, .jsn-new-since, .jsn-profile-card__status { font-family: var(--font-sans); font-variant-numeric: tabular-nums; letter-spacing: var(--tracking-caps); text-transform: uppercase; }
.jsn-eyebrow { color: var(--text-muted); font-size: var(--text-2xs); font-weight: var(--weight-bold); }
.jsn-module-header { display: flex; align-items: end; justify-content: space-between; gap: var(--space-4); margin-bottom: var(--space-6); }
.jsn-module-header p { margin: var(--space-1) 0 0; color: var(--text-muted); }
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
@media (max-width: 44rem) { .jsn-landing-heading { align-items: start; flex-direction: column; } .jsn-module-header { align-items: start; flex-direction: column; } }
`;
