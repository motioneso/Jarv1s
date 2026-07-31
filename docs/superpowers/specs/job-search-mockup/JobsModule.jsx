/* PROVENANCE — do not edit. Verbatim copy of `ui_kits/jarvis-app/JobsModule.jsx` from the
   "Jarvis — Park Press Design System" project in Claude Design, pulled 2026-07-28.
   This is the job-search module as it sits *inside the Jarvis app shell*, so it is the authority
   on tab order and tab styling — not the standalone `ui_kits/job-search/index.html` harness.
   Read `README.md` in this directory first. */
/* Job Search module hosted inside the Jarvis app shell — internal tabs + screens. */
(function () {
  const Ic = window.Ic;
  const TABS = [["matches", "Matches"], ["overview", "Overview"], ["profile", "Profile"], ["monitors", "Monitors"]];

  function TabBar({ tab, setTab }) {
    return (
      <nav style={{ display: "flex", gap: 4, margin: "0 0 30px", borderBottom: "1px solid var(--line)" }}>
        {TABS.map(([id, label]) => {
          const on = tab === id;
          return (
            <button key={id} onClick={() => setTab(id)} style={{
              all: "unset", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 500,
              letterSpacing: "0.14em", textTransform: "uppercase", color: on ? "var(--ink)" : "var(--ink-3)",
              padding: "12px 16px", position: "relative"
            }}>
              {label}
              {on ? <span style={{ position: "absolute", left: 12, right: 12, bottom: -1, height: 3, background: "var(--gold)" }} /> : null}
            </button>
          );
        })}
      </nav>
    );
  }

  function JobsModule() {
    const [tab, setTab] = React.useState("matches");
    let Screen;
    if (tab === "overview") Screen = <window.JobsOverview onGoMatches={() => setTab("matches")} />;
    else if (tab === "profile") Screen = <window.JobsProfile />;
    else if (tab === "monitors") Screen = <window.JobsMonitors />;
    else Screen = <window.JobsMatches />;
    return (
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <TabBar tab={tab} setTab={setTab} />
        <div key={tab}>{Screen}</div>
      </div>
    );
  }
  window.JobsModule = JobsModule;
})();
