export type ProfileCard = {
  readonly id: string;
  readonly title: string;
  readonly status: string;
};

export function profileCardsFromResult(value: unknown): ProfileCard[] {
  if (!value || typeof value !== "object") return [];
  const profiles = (value as { profiles?: unknown }).profiles;
  if (!Array.isArray(profiles)) return [];
  return profiles.flatMap((profile): ProfileCard[] => {
    if (!profile || typeof profile !== "object") return [];
    const candidate = profile as Record<string, unknown>;
    if (typeof candidate.id !== "string" || typeof candidate.title !== "string") return [];
    return [
      {
        id: candidate.id,
        title: candidate.title,
        status: typeof candidate.status === "string" ? candidate.status : "building"
      }
    ];
  });
}

export function landingState(profiles: readonly unknown[]): "first-run" | "configured" {
  return profiles.length === 0 ? "first-run" : "configured";
}
