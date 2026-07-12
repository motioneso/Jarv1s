// external-modules/job-search/src/web/styles.ts
// JS-06 (#935): layout-only module CSS injected by the Root as a <style> tag.
// ZERO color/typography declarations — visual identity comes entirely from the
// host's jds-* primitives and document styles, so the tokens.css raw-color
// rule and theme switching are untouched by this module.
export const MODULE_STYLES = `
.jsm-root { max-width: 72rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
.jsm-header { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 1rem; }
.jsm-nav { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1.5rem; }
.jsm-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); }
.jsm-stack { display: flex; flex-direction: column; gap: 1rem; }
.jsm-row { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
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
`;
