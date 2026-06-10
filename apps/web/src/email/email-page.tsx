import { ComingSoon } from "../shell/coming-soon";

export function EmailPage() {
  return (
    <section className="page-stack" aria-labelledby="email-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Email</p>
          <h1 id="email-title">Email</h1>
        </div>
      </div>
      <ComingSoon title="Email" note="Email sync arrives in Phase 3." />
    </section>
  );
}
