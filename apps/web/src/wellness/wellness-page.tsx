import { useState } from "react";

import { FeelingsCheckinModal } from "./feelings-checkin-modal";
import { MedicationsView } from "./medications-view";

type Tab = "feelings" | "medications";

export function WellnessPage() {
  const [tab, setTab] = useState<Tab>("feelings");
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <section className="page-stack" aria-labelledby="wellness-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Wellness</p>
          <h1 id="wellness-title">Wellness</h1>
        </div>
        <div className="segmented-control" role="group" aria-label="Wellness view">
          <button
            type="button"
            className={tab === "feelings" ? "active" : ""}
            onClick={() => setTab("feelings")}
          >
            Feelings
          </button>
          <button
            type="button"
            className={tab === "medications" ? "active" : ""}
            onClick={() => setTab("medications")}
          >
            Medications
          </button>
        </div>
      </div>

      {tab === "feelings" ? (
        <div className="wellness-feelings">
          <button type="button" className="primary-button" onClick={() => setModalOpen(true)}>
            Log how you feel
          </button>
          <FeelingsCheckinModal open={modalOpen} onClose={() => setModalOpen(false)} />
        </div>
      ) : (
        <MedicationsView />
      )}
    </section>
  );
}
