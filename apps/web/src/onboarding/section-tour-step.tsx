import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { getModules, getMyModules } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { buildTourSections } from "./section-tour-model";

export function SectionTourStep(props: { readonly onDone: () => void }) {
  const modulesQuery = useQuery({
    queryKey: queryKeys.modules,
    queryFn: () => getModules(),
    retry: false
  });
  // Per-user enablement: a module the actor has disabled must NOT appear in the tour even
  // though it is instance-enabled. /api/modules carries navigation but not the actor's
  // per-user state; /api/me/modules carries the actor's `active` flag (Phase-2 disable seam).
  // We combine them the same way the app shell does (readNavigation): drop nav for any
  // module the actor has turned off — otherwise the tour would link a route the route guard
  // 404s for this member.
  const myModulesQuery = useQuery({
    queryKey: queryKeys.myModules,
    queryFn: () => getMyModules(),
    retry: false
  });

  // Build the set of enabled nav paths from the modules registry, gated on per-user state.
  // Settings is always present (core); a section whose route is not in the enabled nav set
  // is omitted — this is how "Wellness" disappears when it's uninstalled OR the actor disabled it.
  const disabledModuleIds = (myModulesQuery.data?.modules ?? [])
    .filter((m) => !m.active)
    .map((m) => m.id);
  const sections = buildTourSections(modulesQuery.data?.modules ?? [], disabledModuleIds);

  return (
    <section className="onb-step" aria-labelledby="member-tour-title">
      <p className="onb-eyebrow">Step 3 · Where to go</p>
      <h1 id="member-tour-title" className="onb-title">
        Here’s where to start.
      </h1>
      <p className="onb-lede">
        A short orientation. Each part of Jarvis has a job. Here’s what to reach for, and when.
      </p>
      <ul className="connect-steps onb-tour">
        {sections.map((s) => (
          <li key={s.path} className="onb-tour__row">
            <Link to={s.path}>
              <strong>{s.label}</strong>
            </Link>
            {" — "}
            {s.blurb}
          </li>
        ))}
      </ul>
      <button className="primary-button" type="button" onClick={props.onDone}>
        Finish
      </button>
    </section>
  );
}
