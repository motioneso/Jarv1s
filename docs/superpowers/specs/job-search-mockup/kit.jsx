/* PROVENANCE — do not edit.
   Verbatim copy of `ui_kits/job-search/kit.jsx` from the "Jarvis — Park Press Design System"
   project in Claude Design (projectId 0501fab4-7c60-457d-9a46-b717d55e16c9), pulled 2026-07-29.

   It lives in the repo because build agents have no DesignSync tool — this is the only way they can
   read the design source. Treat it as the authority on where colour goes; treat the repo's current
   job-search UI as the thing that has to change to match it.

   TWO TRANSLATIONS APPLY when implementing against this file:
   1. `var(--font-mono)` — Jarv1s retired mono on 2026-07-08. Every monoLabel here becomes
      `--font-sans` with `tabular-nums`, which is what `jds-eyebrow` already does.
   2. Inline `style={{}}` and raw `var(--token)` — a module may not carry design tokens in its own
      CSS (`grep -c 'var(--' external-modules/job-search/src/web/styles.css` must stay 0). Colour
      arrives only through host `jds-*` classes. Where no host class exists for a colour location
      in here, that is a real platform gap to report, not licence to inline a token.
*/
/* Job Search UI kit — shared Park Press presentational helpers.
   Keyline-grid only: hairline rules + committed fields, no floating cards,
   no score badges, no confidence meters. Exposes window.JobKit. */
(function () {
  const monoLabel = {
    fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 500,
    letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--ink-3)"
  };

  function Eyebrow({ children, tone, style }) {
    const color = tone === "gold" ? "var(--gold-hover)" : tone === "muted" ? "var(--ink-3)" : "var(--ink-2)";
    return <p style={{ ...monoLabel, color, margin: 0, ...style }}>{children}</p>;
  }

  function Strap({ w = 30, color = "var(--gold)", style }) {
    return <span style={{ display: "block", width: w, height: 3, background: color, ...style }} />;
  }

  function SectionHead({ children, trailing, style }) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "0 0 14px", ...style }}>
        <span style={{ ...monoLabel, whiteSpace: "nowrap" }}>{children}</span>
        <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
        {trailing ?? null}
      </div>
    );
  }

  /* Fit reads as a keyline rail (same idiom as TaskRow's priority bar) plus a
     mono word — never a colored score pill. */
  const FIT = {
    strong: { label: "Strong fit", rail: "var(--accent)", fg: "var(--accent)" },
    good:   { label: "Good fit",   rail: "var(--steel)",  fg: "var(--ink-2)" },
    fair:   { label: "Fair fit",   rail: "var(--line-strong)", fg: "var(--ink-3)" },
    weak:   { label: "Weak fit",   rail: "var(--line)",   fg: "var(--ink-3)" }
  };
  function FitMark({ band, style }) {
    const f = FIT[band] ?? FIT.fair;
    return <span style={{ ...monoLabel, fontSize: 10, letterSpacing: "0.14em", color: f.fg, ...style }}>{f.label}</span>;
  }

  /* Inline mono meta — plain text in the row's meta line, no outline pill. */
  function Meta({ children, tone, style }) {
    const c = tone === "gold" ? "var(--gold-hover)" : "var(--ink-2)";
    return (
      <span style={{
        fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 500, letterSpacing: "0.1em",
        textTransform: "uppercase", color: c, ...style
      }}>{children}</span>
    );
  }

  /* Mono label over a value, hairline-ruled above — the platform's instrument idiom. */
  function Field({ label, children, ruled = true, style }) {
    return (
      <div style={{ borderTop: ruled ? "1px solid var(--line)" : "none", paddingTop: ruled ? 10 : 0, ...style }}>
        <div style={{ ...monoLabel, fontSize: 9, marginBottom: 5 }}>{label}</div>
        {children}
      </div>
    );
  }

  function Figure({ children, size = 24 }) {
    return <div style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: size, letterSpacing: "-0.01em", color: "var(--ink)", fontVariantNumeric: "tabular-nums", lineHeight: 1.05 }}>{children}</div>;
  }

  /* Flush chip — 2px radius per the system, no 999px pills outside dots/avatars. */
  function Chip({ children, tone, dashed, title }) {
    const tones = {
      neutral: { bg: "var(--oat-lo)", fg: "var(--ink)" },
      gold: { bg: "transparent", fg: "var(--gold-hover)" },
      amber: { bg: "var(--amber-field)", fg: "var(--amber)" }
    };
    const t = tones[tone] ?? tones.neutral;
    return (
      <span title={title} style={{
        display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 500,
        padding: "6px 11px", borderRadius: 2, color: t.fg, background: t.bg,
        border: dashed ? "1px dashed color-mix(in srgb, var(--gold) 55%, transparent)" : "1px solid transparent"
      }}>{children}</span>
    );
  }

  function StatusDot({ ok, on = "var(--accent)", off = "var(--ink-3)" }) {
    return <span style={{ width: 7, height: 7, borderRadius: 999, background: ok ? on : off, flex: "none" }} />;
  }

  window.JobKit = { monoLabel, Eyebrow, Strap, SectionHead, FitMark, Meta, Field, Figure, Chip, StatusDot, FIT };
})();
