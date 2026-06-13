import { assertDataContextDb, type DataContextDb, type WellnessCheckin } from "@jarv1s/db";
import { ChatMemoryFactsRepository } from "@jarv1s/memory";

const ENERGY_TREND_TAG = "[wellness:energy-trend]";

/**
 * Abstracted, non-clinical energy trend derived from recent self-rated ENERGY (1–5), NOT
 * emotion intensity (Codex R1 — do not conflate the two). Returns null when no recent
 * check-in carries an energy rating. The string MUST NOT contain raw feeling words — only
 * an energy-level abstraction (privacy posture / no health-content leakage).
 */
export function deriveEnergyTrend(
  recent: ReadonlyArray<Pick<WellnessCheckin, "energy" | "feeling_core">>
): string | null {
  const energies = recent.map((c) => c.energy).filter((n): n is number => typeof n === "number");
  if (energies.length === 0) return null;

  const avg = energies.reduce((sum, n) => sum + n, 0) / energies.length;
  const days = energies.length;
  let level: string;
  if (avg <= 2) level = "low";
  else if (avg >= 4) level = "high";
  else level = "moderate";

  return `${ENERGY_TREND_TAG} Energy has trended ${level} over the last ${days.toString()} recent check-ins.`;
}

export class WellnessRecallContributor {
  constructor(
    private readonly facts: ChatMemoryFactsRepository = new ChatMemoryFactsRepository()
  ) {}

  /**
   * Recompute the energy-trend and store it as a single owner profile fact. Supersedes
   * any prior wellness energy-trend fact so only the latest is active. Uses the memory
   * module's PUBLIC API only — never imports memory internals (module-isolation).
   */
  async refreshEnergyTrendFact(scopedDb: DataContextDb, ownerUserId: string): Promise<void> {
    assertDataContextDb(scopedDb);
    const recent = await scopedDb.db
      .selectFrom("app.wellness_checkins")
      .select(["energy", "feeling_core"])
      .orderBy("checked_in_at", "desc")
      .limit(7)
      .execute();

    const trend = deriveEnergyTrend(
      recent as Array<Pick<WellnessCheckin, "energy" | "feeling_core">>
    );

    const active = await this.facts.listActiveFacts(scopedDb, ownerUserId);
    for (const fact of active) {
      if (fact.category === "profile" && fact.content.includes(ENERGY_TREND_TAG)) {
        await this.facts.supersedeFact(scopedDb, fact.id);
      }
    }

    if (trend) {
      await this.facts.insertFact(scopedDb, ownerUserId, {
        category: "profile",
        content: trend,
        importance: 0.6
      });
    }
  }
}
