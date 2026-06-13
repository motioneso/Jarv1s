import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { getModules } from "../api/client";
import { queryKeys } from "../api/query-keys";

interface TourSection {
  readonly path: string;
  readonly label: string;
  readonly blurb: string;
}

// One line each for the now-real product sections. A section is shown only if its
// route is enabled for this member (derived from the modules list — module isolation:
// we read the modules registry's public endpoint, never another module's tables).
const ALL_SECTIONS: readonly TourSection[] = [
  {
    path: "/tasks",
    label: "Tasks",
    blurb: "Your single action surface — todos, commitments, and plans."
  },
  { path: "/calendar", label: "Calendar", blurb: "Events synced from your connected accounts." },
  { path: "/email", label: "Email", blurb: "Recent messages from your connected accounts." },
  { path: "/briefings", label: "Briefings", blurb: "Scheduled summaries grounded in your data." },
  { path: "/wellness", label: "Wellness", blurb: "Your private well-being check-ins." },
  { path: "/notifications", label: "Notifications", blurb: "What needs your attention." },
  { path: "/settings", label: "Settings", blurb: "Connect accounts, AI, and manage your profile." }
];

export function SectionTourStep(props: { readonly onDone: () => void }) {
  const modulesQuery = useQuery({
    queryKey: queryKeys.modules,
    queryFn: () => getModules(),
    retry: false
  });

  // Build the set of enabled nav paths from the modules registry. Settings is always
  // present (core); a section whose route is not in the enabled nav set is omitted —
  // this is how "Wellness" disappears cleanly when no wellness module is installed.
  const enabledPaths = new Set<string>(["/settings"]);
  for (const mod of modulesQuery.data?.modules ?? []) {
    for (const nav of mod.navigation) {
      enabledPaths.add(nav.path);
    }
  }
  const sections = ALL_SECTIONS.filter((s) => enabledPaths.has(s.path));

  return (
    <section className="panel" aria-labelledby="member-tour-title">
      <div className="panel-heading">
        <h2 id="member-tour-title">A quick tour</h2>
      </div>
      <p>Here&apos;s what you can do. Everything below is private to you.</p>
      <ul className="connect-steps">
        {sections.map((s) => (
          <li key={s.path}>
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
