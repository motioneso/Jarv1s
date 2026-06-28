import { useQuery } from "@tanstack/react-query";
import { Target } from "lucide-react";
import { listGoals } from "../api/client.js";
import { queryKeys } from "../api/query-keys.js";

export function GoalsSection() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.goals.list,
    queryFn: listGoals
  });

  if (isLoading || !data?.items || data.items.length === 0) {
    return null;
  }

  const activeGoals = data.items.filter(g => g.status === "active");
  if (activeGoals.length === 0) return null;

  return (
    <section className="jds-brief">
      <div className="jds-brief__head">
        <span className="jds-brief__kicker">Focus</span>
      </div>
      <div className="jds-brief__title">Long-term goals</div>
      <div className="loose">
        {activeGoals.map((goal) => (
          <div className="loose-row" key={goal.id}>
            <span className="loose-row__ic">
              <Target size={15} aria-hidden="true" />
            </span>
            <div className="loose-row__main">
              <div className="loose-row__title">{goal.title}</div>
              <div className="loose-row__meta">{goal.desiredOutcome}</div>
            </div>
            <div className="loose-row__act">
              {goal.priority ? (
                <span className="jds-drift">
                  <span className="jds-drift__dot" />
                  P{goal.priority}
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
