import { ComingSoon } from "../shell/coming-soon";

export function CalendarPage() {
  return (
    <section className="page-stack" aria-labelledby="calendar-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Calendar</p>
          <h1 id="calendar-title">Calendar</h1>
        </div>
      </div>
      <ComingSoon title="Calendar" note="Calendar sync arrives in Phase 3." />
    </section>
  );
}
