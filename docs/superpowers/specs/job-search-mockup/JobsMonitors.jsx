/* PROVENANCE — do not edit. Verbatim copy of `ui_kits/job-search/JobsMonitors.jsx` from the
   "Jarvis — Park Press Design System" project in Claude Design, pulled 2026-07-28.
   Read `README.md` in this directory first: two translations (mono → sans+tabular-nums, and
   inline tokens → host `jds-*` classes) apply to everything in here.

   NOTE for whoever builds this screen: of the four Fields per row, only "Schedule" has anywhere to
   read from today. "Last checked", "Last success" and "Found today" are not stored anywhere in the
   module schema — building this grid honestly needs a migration plus crawl-side writes. Do not
   fake them. */
/* Job Search — Monitors: the boards Jarvis watches, their health, and manual runs. */
(function () {
  const DS = window.JarvisParkPressDesignSystem_0501fa;
  const { Button } = DS;
  const { monoLabel, Eyebrow, SectionHead, Strap, Meta, StatusDot } = window.JobKit;
  const Ic = window.Ic;

  const MONITORS = [
    { id: "m1", adapter: "Greenhouse", query: "Product Design · Remote US", due: "7:00 AM", tz: "PT", checked: "6:41 AM today", success: "6:41 AM today", enabled: true, found: 4 },
    { id: "m2", adapter: "Lever", query: "Design Engineer · Remote", due: "7:00 AM", tz: "PT", checked: "6:41 AM today", success: "6:41 AM today", enabled: true, found: 1 },
    { id: "m3", adapter: "Ashby", query: "Staff / Principal Designer", due: "7:00 AM", tz: "PT", checked: "6:41 AM today", success: "yesterday 7:00 AM", enabled: true, found: 1 }
  ];

  function RunNow() {
    const [state, setState] = React.useState("idle");
    const label = state === "idle" ? "Run now" : state === "pending" ? "Queuing…" : "Run queued";
    return (
      <Button variant="quiet" size="sm" disabled={state !== "idle"}
        iconLeft={<Ic n={state === "settled" ? "Check" : "Play"} s={13} />}
        onClick={() => { setState("pending"); setTimeout(() => setState("settled"), 700); }}>
        {label}
      </Button>
    );
  }

  function MonitorRow({ m }) {
    const [on, setOn] = React.useState(m.enabled);
    return (
      <div style={{ display: "grid", gridTemplateColumns: "3px 1fr", gap: 16, padding: "18px 0", borderTop: "1px solid var(--line)" }}>
        <span style={{ alignSelf: "stretch", background: on ? "var(--accent)" : "var(--line)", borderRadius: 2 }} />
        <div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, minWidth: 0 }}>
              <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 19, letterSpacing: "-0.02em", color: "var(--ink)" }}>{m.adapter}</span>
              <span style={{ fontSize: 14, color: "var(--ink-2)" }}>{m.query}</span>
            </div>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, flex: "none" }}>
              <StatusDot ok={on} />
              <Meta style={{ fontSize: 9.5, color: on ? "var(--accent)" : "var(--ink-3)" }}>{on ? "Enabled" : "Paused"}</Meta>
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, margin: "16px 0 14px" }}>
            {[["Schedule", `${m.due} ${m.tz}`], ["Last checked", m.checked], ["Last success", m.success], ["Found today", `${m.found} new`]].map(([k, v]) => (
              <div key={k}>
                <div style={{ ...monoLabel, fontSize: 9, marginBottom: 5 }}>{k}</div>
                <div style={{ fontSize: 13.5, color: "var(--ink)", fontWeight: 500 }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <RunNow />
            <Button variant="quiet" size="sm" onClick={() => setOn((o) => !o)} iconLeft={<Ic n={on ? "Pause" : "Play"} s={13} />}>{on ? "Pause" : "Enable"}</Button>
            <Button variant="quiet" size="sm" iconLeft={<Ic n="Settings2" s={13} />}>Edit query</Button>
          </div>
        </div>
      </div>
    );
  }

  function JobsMonitors() {
    return (
      <div>
        <section style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, paddingBottom: 24, flexWrap: "wrap" }}>
          <div>
            <Eyebrow tone="gold" style={{ marginBottom: 12 }}>Daily discovery · next run 7:00 AM PT</Eyebrow>
            <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 44, letterSpacing: "-0.03em", lineHeight: 0.92, textTransform: "uppercase", margin: 0, color: "var(--ink)" }}>Monitors</h1>
            <Strap style={{ marginTop: 16 }} />
            <p style={{ fontSize: 14, color: "var(--ink-2)", margin: "14px 0 0", maxWidth: "54ch", textWrap: "pretty" }}>
              I check these boards every morning and only surface what clears your bar. Nothing is applied on your behalf.
            </p>
          </div>
          <Button variant="primary" iconLeft={<Ic n="Plus" s={16} />}>Add a monitor</Button>
        </section>
        <div style={{ height: 3, background: "var(--ink)" }} />

        <div style={{ marginTop: 28 }}>
          <SectionHead trailing={<Meta style={{ fontSize: 9.5, color: "var(--ink-3)" }}>3 enabled · all healthy</Meta>}>Watched boards</SectionHead>
          <div style={{ borderBottom: "1px solid var(--line)" }}>
            {MONITORS.map((m) => <MonitorRow key={m.id} m={m} />)}
          </div>
          <p style={{ fontSize: 12.5, color: "var(--ink-3)", margin: "18px 0 0", display: "flex", alignItems: "center", gap: 8 }}>
            <Ic n="ShieldCheck" s={14} /> Sources are keyless public job-board APIs. Jarvis reads postings — it never submits anything.
          </p>
        </div>
      </div>
    );
  }

  window.JobsMonitors = JobsMonitors;
})();
