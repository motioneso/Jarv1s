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
.jsm-display--compact { margin-top: 0.75rem; font-size: clamp(2.5rem, 5vw, 3.25rem); }
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
.jsm-monitor-hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 1.5rem; flex-wrap: wrap; }
.jsm-monitor-card { display: grid; gap: 1.1rem; }
.jsm-monitor-card__head, .jsm-source-title { display: flex; align-items: flex-start; gap: 0.875rem; }
.jsm-monitor-card__head { justify-content: space-between; }
.jsm-source-title h3 { margin: 0; font-family: var(--font-display); font-size: 1.125rem; font-weight: 800; }
.jsm-source-title p { margin: 0.25rem 0 0; color: var(--ink-2); font-size: 0.85rem; }
.jsm-source-glyph, .jsm-file-glyph { display: inline-flex; flex: none; align-items: center; justify-content: center; background: var(--surface-2); color: var(--ink); border-radius: var(--radius-md); }
.jsm-source-glyph { width: 2.5rem; height: 2.5rem; }
.jsm-source-glyph svg { width: 1.2rem; height: 1.2rem; }
.jsm-monitor-meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.875rem; margin: 0; padding-top: 1rem; border-top: 1px solid var(--line); }
.jsm-monitor-meta dt, .jsm-monitor-meta dd { margin: 0; }
.jsm-monitor-meta dd { margin-top: 0.3rem; font-size: 0.84rem; font-weight: 500; }
.jsm-source-note { margin: 1rem 0 0; color: var(--ink-3); font-size: 0.78rem; }
.jsm-profile-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.625rem; align-items: start; }
.jsm-profile-card, .jsm-profile-fields { display: grid; gap: 1.25rem; }
.jsm-profile-card__head { display: flex; align-items: center; gap: 0.875rem; }
.jsm-profile-card__head h3 { margin: 0; font-family: var(--font-display); font-size: 1.125rem; font-weight: 800; }
.jsm-profile-card__head p { margin: 0.25rem 0 0; }
.jsm-file-glyph { width: 2.75rem; height: 2.75rem; background: var(--ink); color: var(--paper); }
.jsm-file-glyph svg { width: 1.4rem; height: 1.4rem; }
.jsm-field, .jsm-profile-fields { display: grid; }
.jsm-field { gap: 0.5rem; }
.jsm-profile-fields { gap: 1.25rem; }
.jsm-field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
.jsm-critique { padding: 0.875rem 1rem; border-radius: var(--radius-md); background: var(--surface-2); }
.jsm-critique p { margin: 0.45rem 0 0; color: var(--ink-2); font-size: 0.84rem; line-height: 1.55; }
.jsm-numeric { font-variant-numeric: tabular-nums; }
.jsm-dealbreaker { display: inline-flex; padding: 0.35rem 0.7rem; border-radius: var(--radius-pill); background: var(--amber-soft); color: var(--amber-strong); font-size: 0.78rem; }
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
.ob2 { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 30px; min-height: 0; }
.ob2-chat { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.ob2-head { padding-bottom: 1rem; border-bottom: 3px solid var(--ink); }
.jsm-control-stack { display: grid; gap: 0.75rem; }
.jsm-chip-row, .jsm-run-time { display: flex; flex-wrap: wrap; align-items: center; gap: 0.55rem; }
.jsm-chip { display: inline-flex; align-items: center; gap: 0.4rem; border-color: var(--line-strong); background: var(--surface); color: var(--ink); }
.jsm-chip.is-active { border-color: var(--accent); background: var(--accent); color: var(--text-on-accent); }
.jsm-chip.is-inferred { border-style: dashed; border-color: var(--gold); color: var(--gold-strong); }
.jsm-add-input { display: inline-flex; align-items: flex-start; gap: 0.4rem; }
.jsm-add-input > span { display: grid; gap: 0.25rem; }
.jsm-add-input input, .jsm-source-control > input, .jsm-paste-fallback textarea { border: 1px dashed var(--line-strong); border-radius: var(--radius-pill); padding: 0.5rem 0.75rem; color: var(--ink); background: var(--surface-2); font: inherit; }
.jsm-add-input small, .jsm-source-control small { display: block; max-width: 42ch; color: var(--ink-3); font-size: 0.72rem; line-height: 1.35; }
.jsm-dropzone { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.625rem; box-sizing: border-box; width: 100%; padding: 1.875rem 1.5rem; cursor: pointer; text-align: center; border: 1px dashed var(--line-strong); border-radius: var(--radius-lg); background: var(--surface); }
.jsm-dropzone:focus-within { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
.jsm-control-error { margin: 0; color: var(--red); }
.jsm-paste-fallback { display: grid; gap: 0.5rem; }
.jsm-paste-fallback textarea { border-radius: var(--radius-md); resize: vertical; }
.jsm-source-list { display: grid; gap: 0.5rem; }
.jsm-source-control { display: grid; gap: 0.65rem; padding: 0.75rem; }
.jsm-source-control > label { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.jsm-source-control strong { display: block; }
.jsm-source-control > input { border-style: solid; border-radius: var(--radius-md); }
.jsm-critique-card { padding: 1rem 1.125rem; border: 1px dashed var(--gold); border-radius: var(--radius-lg); background: color-mix(in srgb, var(--gold) 4%, var(--surface)); }
.jsm-critique-card > p { line-height: 1.55; }
.jsm-critique-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
.jsm-critique-grid ul { display: grid; gap: 0.4rem; margin: 0.5rem 0 0; padding-left: 1.1rem; color: var(--ink-2); }
.jsm-profile-aside { position: sticky; top: 0; align-self: start; padding: 1.25rem; border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--surface); }
.jsm-profile-aside__rows { display: grid; margin-top: 1rem; }
.jsm-profile-aside__row { display: grid; grid-template-columns: 1.4rem minmax(0, 1fr); gap: 0.7rem; padding: 0.6rem 0; border-bottom: 1px solid var(--line); }
.jsm-profile-aside__row:last-child { border-bottom: 0; }
.jsm-profile-aside__row > span:last-child { display: grid; gap: 0.2rem; }
.jsm-profile-aside__row strong { overflow-wrap: anywhere; font-size: 0.8rem; }
.jsm-aside-status { display: inline-flex; width: 1.35rem; height: 1.35rem; align-items: center; justify-content: center; border-radius: var(--radius-pill); background: var(--surface-2); color: var(--ink-3); }
.jsm-aside-status.is-set { background: var(--accent); color: var(--text-on-accent); }
.jsm-summary { display: grid; gap: 0.875rem; }
@media (max-width: 760px) {
  .jsm-hero, .jsm-overview-grid, .jsm-detail-grid { grid-template-columns: 1fr; gap: 1.5rem; }
  .jsm-display { font-size: clamp(2.5rem, 14vw, 3.75rem); }
  .jsm-match-card__head { flex-direction: column; }
  .jsm-match-card__score { flex-direction: row; align-items: center; }
  .jsm-evidence-grid { grid-template-columns: 1fr; }
  .jsm-monitor-meta { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .jsm-profile-grid { grid-template-columns: 1fr; }
  .jsm-checkpoint { grid-template-columns: 2rem minmax(0, 1fr); }
  .jsm-checkpoint > :last-child { grid-column: 2; }
  .ob2 { grid-template-columns: 1fr; gap: 1.5rem; }
  .jsm-profile-aside { position: static; }
  .jsm-critique-grid { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .jsm-chip { transition: none; }
}
`;
