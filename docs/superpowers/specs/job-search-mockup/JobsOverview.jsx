/* PROVENANCE — do not edit. Verbatim copy of `ui_kits/job-search/JobsOverview.jsx` from the
   "Jarvis — Park Press Design System" project in Claude Design, pulled 2026-07-28
   via the Claude Design MCP endpoint (DesignSync's get_file could not return it).
   Read `README.md` in this directory first: two translations (mono -> sans+tabular-nums,
   and inline tokens -> host `jds-*` classes) apply to everything in here. */
/* Job Search — Overview: search readiness, onboarding checkpoints, monitor health. */
(function () {
  const DS = window.JarvisParkPressDesignSystem_0501fa;
  const { Button, Card } = DS;
  const { monoLabel, Eyebrow, Strap, SectionHead, Meta, Field, Figure, StatusDot } = window.JobKit;
  const Ic = window.Ic;

  const STEPS = [
    { id: "profile", label: "Build your search profile", body: "Target titles, locations, comp floor, and dealbreakers.", status: "done" },
    { id: "resume", label: "Add & critique your resume", body: "Jarvis reads it, flags gaps, and stores an approved revision.", status: "done" },
    { id: "sources", label: "Choose sources & schedule", body: "Which boards to watch and when the daily run happens.", status: "done" },
    { id: "review", label: "Review your first matches", body: "Confirm a save or pass so Jarvis learns your taste.", status: "current" }
  ];

  const GATES = [
    { label: "Profile", ok: true, okLabel: "Approved", pending: "Pending" },
    { label: "Resume", ok: true, okLabel: "Approved", pending: "Pending" },
    { label: "Monitoring", ok: true, okLabel: "On", pending: "Off" }
  ];

  const RAIL = { done: "var(--accent)", current: "var(--gold)", todo: "var(--line)" };

  function StepRow({ s }) {
    const muted = s.status === "todo";
    return (
      <div style={{ display: "grid", gridTemplateColumns: "3px 1fr auto", gap: 16, alignItems: "start", padding: "16px 0", borderTop: "1px solid var(--line)" }}>
        <span style={{ alignSelf: "stretch", background: RAIL[s.status], borderRadius: 2 }} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: muted ? "var(--ink-3)" : "var(--ink)", marginBottom: 3 }}>{s.label}</div>
          <div style={{ fontSize: 13, color: "var(--ink-2)", textWrap: "pretty" }}>{s.body}</div>
        </div>
        <div style={{ paddingTop: 3 }}>
          {s.status === "current"
            ? <Meta tone="gold" style={{ fontSize: 9.5 }}>Now</Meta>
            : s.status === "done"
            ? <Meta style={{ fontSize: 9.5, color: "var(--accent)" }}>Done</Meta>
            : <Meta style={{ fontSize: 9.5, color: "var(--ink-3)" }}>To do</Meta>}
        </div>
      </div>
    );
  }

  function JobsOverview({ onGoMatches }) {
    const done = STEPS.filter((s) => s.status === "done").length;
    return (
      <div>
        {/* HERO — readiness */}
        <section style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr", gap: 40, alignItems: "end", paddingBottom: 26 }}>
          <div>
            <Eyebrow tone="gold" style={{ marginBottom: 14 }}>Setup · {done} of {STEPS.length} complete</Eyebrow>
            <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 62, letterSpacing: "-0.035em", lineHeight: 0.88, textTransform: "uppercase", margin: 0, color: "var(--ink)" }}>
              Almost<br /><span style={{ color: "var(--accent)" }}>ready to go</span>
            </h1>
            <Strap style={{ marginTop: 18 }} />
            <p style={{ fontFamily: "var(--font-text)", fontSize: 14.5, color: "var(--ink-2)", margin: "16px 0 0", maxWidth: "52ch", textWrap: "pretty" }}>
              Your profile and resume are approved and monitoring is live. One thing left — review your first batch of matches so I can learn what you're drawn to.
            </p>
            <div style={{ marginTop: 22 }}>
              <Button variant="primary" iconLeft={<Ic n="ArrowRight" s={16} />} onClick={onGoMatches}>Review new matches</Button>
            </div>
          </div>
          <aside>
            <p style={{ ...monoLabel, color: "var(--ink-2)", margin: "0 0 12px" }}>Readiness gates</p>
            <div>
              {GATES.map((g) => (
                <div key={g.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 0", borderTop: "1px solid var(--line)" }}>
                  <span style={{ fontSize: 14, color: "var(--ink)", fontWeight: 500 }}>{g.label}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                    <StatusDot ok={g.ok} />
                    <Meta style={{ fontSize: 9.5, color: g.ok ? "var(--accent)" : "var(--ink-3)" }}>{g.ok ? g.okLabel : g.pending}</Meta>
                  </span>
                </div>
              ))}
            </div>
          </aside>
        </section>
        <div style={{ height: 3, background: "var(--ink)" }} />

        {/* CHECKPOINTS */}
        <div style={{ marginTop: 30, display: "grid", gridTemplateColumns: "1.35fr 1fr", gap: 40, alignItems: "start" }}>
          <div>
            <SectionHead>Setup checkpoints</SectionHead>
            <div style={{ borderBottom: "1px solid var(--line)" }}>
              {STEPS.map((s) => <StepRow key={s.id} s={s} />)}
            </div>
          </div>

          {/* MONITOR HEALTH */}
          <div>
            <SectionHead trailing={<Meta style={{ fontSize: 9.5, color: "var(--accent)" }}>Healthy</Meta>}>Monitor health</SectionHead>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
              {[["Boards", "3"], ["Enabled", "3"], ["Next run", "7:00"], ["Last success", "6:41"]].map(([k, v]) => (
                <Field key={k} label={k}><Figure size={26}>{v}</Figure></Field>
              ))}
            </div>
            <p style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink-2)", margin: "18px 0 0", borderTop: "1px solid var(--line)", paddingTop: 14, textWrap: "pretty" }}>
              <StatusDot ok />All monitors healthy. 142 postings reviewed today.
            </p>
          </div>
        </div>
      </div>
    );
  }

  window.JobsOverview = JobsOverview;
})();

