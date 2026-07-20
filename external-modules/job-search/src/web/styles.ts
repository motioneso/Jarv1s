// external-modules/job-search/src/web/styles.ts
// JS-06/#1197: module CSS injected by Root. Presentation uses only host token
// names, so themes remain host-owned and raw colors stay in tokens.css.
export const MODULE_STYLES = `
.jsm-root { max-width: 74rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; color: var(--ink); }
.jsm-header { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 1rem; }
.jsm-nav { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1.5rem; }
.jsm-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); }
.jsm-stack { display: flex; flex-direction: column; gap: 1rem; }
.jsm-row { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
.jsm-screen { display: grid; gap: 1.75rem; }
.jsm-hero { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(16rem, 0.9fr); gap: 2.5rem; align-items: end; }
.jsm-hero__copy { max-width: 54ch; margin: 1rem 0 0; color: var(--ink-2); line-height: 1.55; text-wrap: pretty; }
.jsm-display { margin: 0; font-family: var(--font-display); font-size: clamp(2.75rem, 6vw, 4.5rem); font-weight: 800; letter-spacing: -0.035em; line-height: 0.9; text-transform: uppercase; }
.jsm-display__accent { color: var(--accent); }
.jsm-eyebrow { margin: 0; }
.jsm-eyebrow--gold { color: var(--gold-strong); }
.jsm-eyebrow--muted { color: var(--ink-3); }
.jsm-strap { display: block; width: 1.875rem; height: 3px; margin-top: 1rem; background: var(--gold); }
.jsm-rule { height: 3px; background: var(--ink); }
.jsm-section-head { display: flex; align-items: center; gap: 0.875rem; margin-bottom: 0.875rem; }
.jsm-section-head__line { flex: 1; height: 1px; background: var(--line); }
.jsm-fit, .jsm-meta-pill { display: inline-flex; align-items: center; font-family: var(--font-sans); font-size: 0.625rem; font-weight: 600; letter-spacing: 0.1em; line-height: 1; text-transform: uppercase; }
.jsm-fit { padding: 0.35rem 0.625rem; border-radius: var(--radius-sm); }
.jsm-fit--strong { color: var(--text-on-accent); background: var(--accent); }
.jsm-fit--good { color: var(--steel-ink); background: var(--steel-soft); }
.jsm-fit--fair { color: var(--ink-2); background: var(--surface-2); }
.jsm-fit--weak { color: var(--text-subtle); background: var(--surface-2); }
.jsm-meta-pill { padding: 0.25rem 0.5rem; color: var(--ink-2); border: 1px solid var(--line); border-radius: var(--radius-pill); }
.jsm-meta-pill--gold { color: var(--gold-strong); }
.jsm-confidence { display: inline-flex; align-items: center; gap: 0.3rem; }
.jsm-confidence__dot { width: 0.375rem; height: 0.375rem; border: 1px solid var(--line); border-radius: var(--radius-pill); background: var(--surface-2); }
.jsm-confidence__dot.is-active { border-color: var(--gold); background: var(--gold); }
.jsm-overview-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(16rem, 1fr); gap: 2rem; align-items: start; }
.jsm-checkpoints { margin: 0; padding: 0 1.25rem; list-style: none; }
.jsm-checkpoint { display: grid; grid-template-columns: 2rem minmax(0, 1fr) auto; gap: 1rem; align-items: start; padding: 1.1rem 0; border-bottom: 1px solid var(--line); }
.jsm-checkpoint:last-child { border-bottom: 0; }
.jsm-checkpoint__number { display: inline-flex; width: 1.875rem; height: 1.875rem; align-items: center; justify-content: center; border-radius: var(--radius-pill); background: var(--surface-2); font-variant-numeric: tabular-nums; }
.jsm-checkpoint__title { margin: 0 0 0.2rem; font-size: 0.95rem; font-weight: 600; }
.jsm-checkpoint__body { margin: 0; color: var(--ink-2); font-size: 0.82rem; line-height: 1.45; text-wrap: pretty; }
.jsm-gates { display: grid; gap: 0.875rem; }
.jsm-gate { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; }
.jsm-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.125rem 0.75rem; }
.jsm-stat__value { margin-top: 0.3rem; font-family: var(--font-display); font-size: 1.35rem; font-variant-numeric: tabular-nums; }
.jsm-card-copy { margin: 0; color: var(--ink-2); font-size: 0.82rem; line-height: 1.5; }
.jsm-text-accent { color: var(--accent); }
.jsm-text-gold { color: var(--gold-strong); }
.jsm-buckets, .jsm-pill-row, .jsm-button-row, .jsm-detail-score { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.jsm-card-list { display: grid; gap: 0.875rem; margin: 0; padding: 0; list-style: none; }
.jsm-match-card { display: grid; gap: 1rem; }
.jsm-match-card__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1.25rem; }
.jsm-match-card__title { margin: 0; font-family: var(--font-display); font-size: 1.35rem; font-weight: 800; letter-spacing: -0.02em; line-height: 1.05; }
.jsm-match-card__company { margin: 0.35rem 0 0; color: var(--ink-2); font-weight: 600; }
.jsm-match-card__score { display: flex; flex: none; flex-direction: column; align-items: flex-end; gap: 0.625rem; }
.jsm-evidence-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.125rem; padding-top: 1rem; border-top: 1px solid var(--line); }
.jsm-evidence-grid p { margin: 0.35rem 0 0; color: var(--ink-2); font-size: 0.82rem; line-height: 1.5; }
.jsm-detail-title { max-width: 24ch; margin: 0.75rem 0 1.125rem; font-family: var(--font-display); font-size: clamp(2.25rem, 5vw, 3.25rem); font-weight: 800; letter-spacing: -0.03em; line-height: 0.95; text-transform: uppercase; text-wrap: balance; }
.jsm-detail-score { margin-top: 1.25rem; gap: 1rem; }
.jsm-detail-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(18rem, 1fr); gap: 2rem; align-items: start; padding-top: 1.75rem; border-top: 1px solid var(--line); }
.jsm-role-copy { color: var(--ink); line-height: 1.65; text-wrap: pretty; }
.jsm-evaluation { display: grid; gap: 1rem; padding: 1.25rem; border: 1px dashed var(--gold); border-radius: var(--radius-card); background: var(--surface); }
.jsm-evaluation__evidence { display: grid; gap: 0.75rem; }
.jsm-evaluation__evidence p { margin: 0.2rem 0 0; color: var(--ink-2); font-size: 0.8rem; }
.jsm-named-list ul { display: grid; gap: 0.4rem; margin: 0.5rem 0 0; padding-left: 1.1rem; color: var(--ink-2); }
.jsm-named-list--accent li::marker { color: var(--accent); }
.jsm-named-list--amber li::marker { color: var(--amber-strong); }
.jsm-detail-meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.875rem; margin: 0; }
.jsm-detail-meta dt, .jsm-detail-meta dd { margin: 0; }
.jsm-detail-meta dd { margin-top: 0.25rem; }
.jsm-state { display: flex; flex-direction: column; gap: 0.5rem; padding: 1.25rem; }
.jsm-meta { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; margin: 0; }
.jsm-meta dt { margin: 0; }
.jsm-meta dd { margin: 0; }
.jsm-steps { display: flex; flex-direction: column; gap: 0.75rem; margin: 0; padding: 0; list-style: none; }
.jsm-step { display: flex; align-items: baseline; gap: 0.75rem; }
.jsm-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.jsm-prewrap { white-space: pre-wrap; }
.jsm-table { width: 100%; border-collapse: collapse; }
.jsm-table th, .jsm-table td { text-align: left; vertical-align: top; padding: 0.25rem 0.75rem 0.25rem 0; }
@media (max-width: 760px) {
  .jsm-hero, .jsm-overview-grid, .jsm-detail-grid { grid-template-columns: 1fr; gap: 1.5rem; }
  .jsm-display { font-size: clamp(2.5rem, 14vw, 3.75rem); }
  .jsm-match-card__head { flex-direction: column; }
  .jsm-match-card__score { flex-direction: row; align-items: center; }
  .jsm-evidence-grid { grid-template-columns: 1fr; }
  .jsm-checkpoint { grid-template-columns: 2rem minmax(0, 1fr); }
  .jsm-checkpoint > :last-child { grid-column: 2; }
}
`;
