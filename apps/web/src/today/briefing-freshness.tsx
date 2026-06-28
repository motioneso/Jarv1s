import type { SourceFreshnessEntry, SourceFreshnessV1 } from "@jarv1s/shared";

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

const SOURCE_LABEL: Record<string, string> = {
  email: "Email",
  calendar: "Calendar",
  vault: "Notes",
  tasks: "Tasks",
  commitments: "Commitments",
  chats: "Chats",
  goals: "Goals"
};

function formatAge(entry: SourceFreshnessEntry, capturedAt: string): string {
  if (entry.freshnessKind === "realtime") return "live";
  if (!entry.asOf) return "unknown";
  const ageMs = new Date(capturedAt).getTime() - new Date(entry.asOf).getTime();
  if (ageMs < 60_000) return "just now";
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)}m ago`;
  if (ageMs < 86_400_000) return `${Math.round(ageMs / 3_600_000)}h ago`;
  return `${Math.round(ageMs / 86_400_000)}d ago`;
}

function isStale(entry: SourceFreshnessEntry, capturedAt: string): boolean {
  if (entry.freshnessKind === "realtime" || !entry.asOf) return false;
  return new Date(capturedAt).getTime() - new Date(entry.asOf).getTime() > STALE_THRESHOLD_MS;
}

export function BriefingFreshnessList({ freshness }: { readonly freshness: SourceFreshnessV1 }) {
  return (
    <div className="bfresh">
      <span className="bfresh__label">Sources</span>
      <ul className="bfresh__list">
        {freshness.sources.map((entry) => {
          const age = formatAge(entry, freshness.capturedAt);
          return (
            <li key={entry.source} className="bfresh__item">
              <span className="bfresh__source">{SOURCE_LABEL[entry.source] ?? entry.source}</span>
              <span
                className={`bfresh__age${
                  entry.freshnessKind === "realtime"
                    ? " bfresh__age--live"
                    : age === "unknown"
                      ? " bfresh__age--unknown"
                      : ""
                }`}
                title={entry.asOf ?? undefined}
              >
                {age}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function BriefingStaleBanner({ freshness }: { readonly freshness: SourceFreshnessV1 }) {
  const stale = freshness.sources.filter((e) => isStale(e, freshness.capturedAt));
  if (stale.length === 0) return null;
  const names = stale.map((e) => SOURCE_LABEL[e.source] ?? e.source).join(", ");
  return <p className="bfresh__stale">Some sources are over a day old: {names}.</p>;
}

export function parseBriefingFreshness(
  sourceMetadata: Record<string, unknown>
): SourceFreshnessV1 | null {
  const ts = sourceMetadata.sourceTimestamps;
  if (!ts || typeof ts !== "object" || Array.isArray(ts)) return null;
  const rec = ts as Record<string, unknown>;
  if (rec.version !== 1 || typeof rec.capturedAt !== "string" || !Array.isArray(rec.sources))
    return null;
  return ts as SourceFreshnessV1;
}
