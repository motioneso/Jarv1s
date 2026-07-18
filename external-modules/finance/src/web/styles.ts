// external-modules/finance/src/web/styles.ts
// FIN-02 (#1147): layout-only module CSS injected by the Root as a <style>
// tag. ZERO color/typography declarations — visual identity comes entirely
// from the host's jds-* primitives and document styles, so the tokens.css
// raw-color rule and theme switching are untouched by this module.
export const MODULE_STYLES = `
.fnm-root { max-width: 72rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
.fnm-header { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 1rem; }
.fnm-stack { display: flex; flex-direction: column; gap: 1rem; }
.fnm-row { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
.fnm-state { display: flex; flex-direction: column; gap: 0.5rem; padding: 1.25rem; }
.fnm-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.fnm-table { width: 100%; border-collapse: collapse; }
.fnm-table th, .fnm-table td { text-align: left; vertical-align: top; padding: 0.25rem 0.75rem 0.25rem 0; }
.fnm-chips { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.fnm-pill { display: inline-flex; align-items: baseline; gap: 0.5rem; padding: 0.375rem 0.75rem; }
.fnm-feed { list-style: none; margin: 0; padding: 0; }
.fnm-txrow { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 0.75rem; padding: 0.5rem 0.75rem; }
.fnm-txmain { display: flex; flex-direction: column; gap: 0.125rem; min-width: 0; }
.fnm-txmain > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fnm-txtags { display: inline-flex; align-items: center; gap: 0.5rem; }
.fnm-catpick { display: inline-flex; align-items: center; gap: 0.375rem; }
/* Amounts align on digits via numeric variants — mono is retired app-wide. */
.fnm-amount { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
`;
