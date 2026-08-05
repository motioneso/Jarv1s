/* PROVENANCE — do not edit. Verbatim copy of `ui_kits/job-search/JobsProfile.jsx` from the
   "Jarvis — Park Press Design System" project in Claude Design, pulled 2026-07-28.
   Read `README.md` in this directory first: two translations (mono → sans+tabular-nums, and
   inline tokens → host `jds-*` classes) apply to everything in here. */
/* Job Search — Profile: approved resume + search profile (conversational editing lives with Jarvis). */
(function () {
  const DS = window.JarvisParkPressDesignSystem_0501fa;
  const { Badge, Button } = DS;
  const { monoLabel, Eyebrow, SectionHead, Strap, Meta, Chip } = window.JobKit;
  const Ic = window.Ic;

  const TITLES = [
    { v: "Staff Product Designer", inferred: false },
    { v: "Principal Designer", inferred: false },
    { v: "Design Engineer", inferred: true }
  ];
  const LOCATIONS = ["Remote — US", "San Francisco, CA"];
  const DEALBREAKERS = ["On-site 5 days/week", "Below $195k base", "No equity"];

  function Row({ label, children, style }) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 20, alignItems: "baseline", padding: "14px 0", borderTop: "1px solid var(--line)", ...style }}>
        <span style={{ ...monoLabel, fontSize: 9.5 }}>{label}</span>
        <div>{children}</div>
      </div>
    );
  }

  const val = { fontSize: 14.5, color: "var(--ink)" };

  function JobsProfile() {
    return (
      <div>
        <section style={{ paddingBottom: 24 }}>
          <Eyebrow tone="gold" style={{ marginBottom: 12 }}>What Jarvis searches on</Eyebrow>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 44, letterSpacing: "-0.03em", lineHeight: 0.92, textTransform: "uppercase", margin: 0, color: "var(--ink)" }}>Profile & resume</h1>
          <Strap style={{ marginTop: 16 }} />
          <p style={{ fontSize: 14, color: "var(--ink-2)", margin: "14px 0 0", maxWidth: "56ch", textWrap: "pretty" }}>
            This is the lens every match is read through. Edit it in a conversation — I'll draft the change and you approve it.
          </p>
        </section>
        <div style={{ height: 3, background: "var(--ink)" }} />

        <div style={{ marginTop: 30, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40, alignItems: "start" }}>
          {/* RESUME */}
          <div>
            <SectionHead trailing={<Badge tone="accent">Approved</Badge>}>Resume</SectionHead>
            <div style={{ display: "flex", alignItems: "center", gap: 14, paddingBottom: 16 }}>
              <span style={{ width: 42, height: 42, borderRadius: 2, background: "var(--ink)", color: "var(--oat-hi)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Ic n="FileText" s={21} /></span>
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 18, color: "var(--ink)" }}>Ben Ledger — Resume</div>
                <div style={{ ...monoLabel, fontSize: 9.5, marginTop: 3 }}>rev · 7c22a1</div>
              </div>
            </div>
            <Row label="Approved"><span style={val}>July 12, 2026</span></Row>
            <Row label="Confirmed claims"><span style={{ ...val, fontVariantNumeric: "tabular-nums" }}>18 of 21</span></Row>
            <Row label="Latest critique">
              <p style={{ fontSize: 13.5, color: "var(--ink-2)", margin: 0, lineHeight: 1.55, textWrap: "pretty" }}>
                Strong systems narrative. Three metrics still need a source before I'll cite them to an employer — tightened the summary and cut two dated skills.
              </p>
            </Row>
            <div style={{ display: "flex", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
              <Button variant="secondary" size="sm" iconLeft={<Ic n="MessageSquare" s={14} />}>Refine with Jarvis</Button>
              <Button variant="quiet" size="sm" iconLeft={<Ic n="History" s={14} />}>Revisions</Button>
            </div>
          </div>

          {/* SEARCH PROFILE */}
          <div>
            <SectionHead trailing={<Meta style={{ fontSize: 9.5, color: "var(--ink-3)" }}>Updated Jul 12</Meta>}>Search profile</SectionHead>
            <Row label="Target titles" style={{ borderTop: "none", paddingTop: 0 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {TITLES.map((t) => (
                  <Chip key={t.v} tone={t.inferred ? "gold" : "neutral"} dashed={t.inferred}
                    title={t.inferred ? "Inferred from your resume — confirm with Jarvis to lock it in" : undefined}>
                    {t.v}
                    {t.inferred ? <span style={{ ...monoLabel, fontSize: 8, color: "var(--gold-hover)" }}>inferred</span> : null}
                  </Chip>
                ))}
              </div>
            </Row>
            <Row label="Seniority"><span style={val}>Staff / Principal</span></Row>
            <Row label="Comp floor"><span style={{ ...val, fontVariantNumeric: "tabular-nums" }}>$195,000 base</span></Row>
            <Row label="Locations">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{LOCATIONS.map((l) => <Chip key={l}>{l}</Chip>)}</div>
            </Row>
            <Row label="Work mode"><span style={val}>Remote-first · hybrid up to 2 days</span></Row>
            <Row label="Dealbreakers">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {DEALBREAKERS.map((d) => <Chip key={d} tone="amber"><Ic n="X" s={12} />{d}</Chip>)}
              </div>
            </Row>
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
              <Button variant="secondary" size="sm" iconLeft={<Ic n="MessageSquare" s={14} />}>Update with Jarvis</Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  window.JobsProfile = JobsProfile;
})();
