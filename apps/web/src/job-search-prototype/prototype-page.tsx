/*
 * PROTOTYPE — THROWAWAY. Variant switcher for the job-search UI prototype.
 *
 * Three radically different postures on the same fake data, switched by `?v=`. No auth, no
 * router, no API calls — mounted directly from main.tsx so it renders before the app shell.
 * Delete this whole directory once the layout question is answered.
 */

import { useState } from "react";
import { VariantBroadsheet } from "./variant-broadsheet";
import { VariantConsole } from "./variant-console";
import { VariantDesk } from "./variant-desk";
import { VariantFlow } from "./variant-flow";
import "./prototype.css";

const VARIANTS = [
  { key: "desk", label: "Desk", blurb: "Conversation is the page; matches ride in a rail." },
  {
    key: "broadsheet",
    label: "Broadsheet",
    blurb: "A dated edition with a lede and a printed rubric."
  },
  {
    key: "console",
    label: "Console",
    blurb: "Dense operator table; sort each axis independently."
  },
  {
    key: "flow",
    label: "Flow",
    blurb: "The picked shape: chat onboarding, then console. Chat lives in the drawer."
  }
] as const;

type VariantKey = (typeof VARIANTS)[number]["key"];

function readVariant(): VariantKey {
  const v = new URLSearchParams(window.location.search).get("v");
  return VARIANTS.some((x) => x.key === v) ? (v as VariantKey) : "desk";
}

export function JobSearchPrototype() {
  const [variant, setVariant] = useState<VariantKey>(readVariant);

  function pick(next: VariantKey) {
    setVariant(next);
    // Keep the URL shareable without pulling in the router.
    const url = new URL(window.location.href);
    url.searchParams.set("v", next);
    window.history.replaceState(null, "", url.toString());
  }

  const active = VARIANTS.find((v) => v.key === variant) ?? VARIANTS[0];

  return (
    <div className="jp-root">
      <div className="jp-banner">
        <strong>Prototype</strong>
        <span>
          Job Search · {active.label} — {active.blurb}
        </span>
        <span style={{ color: "var(--ink-3)" }}>Fake data. Nothing here is wired to anything.</span>
      </div>

      {variant === "desk" ? <VariantDesk /> : null}
      {variant === "broadsheet" ? <VariantBroadsheet /> : null}
      {variant === "console" ? <VariantConsole /> : null}
      {variant === "flow" ? <VariantFlow /> : null}

      <div className="jp-switch">
        <span className="jp-switch__label">Variant</span>
        {VARIANTS.map((v) => (
          <button
            key={v.key}
            className={`jp-switch__btn${v.key === variant ? " is-active" : ""}`}
            onClick={() => pick(v.key)}
          >
            {v.label}
          </button>
        ))}
      </div>
    </div>
  );
}
