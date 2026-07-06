import { sql } from "kysely";

import { assertDataContextDb, type DataContextDb, type WellnessCheckin } from "@jarv1s/db";
import { ChatMemoryFactsRepository } from "@jarv1s/memory";

const ENERGY_TREND_TAG = "[wellness:energy-trend]";

// Stable namespace for the per-owner transaction advisory lock that serializes concurrent
// energy-trend refreshes (a constant first key; the owner hash is the second key). Any fixed
// 32-bit int unlikely to collide with other advisory-lock users works.
const ENERGY_TREND_LOCK_NAMESPACE = 0x77656c6c; // 'well'

/**
 * Abstracted, non-clinical energy trend derived from recent self-rated ENERGY (1–5), NOT
 * emotion intensity (Codex R1 — do not conflate the two). Returns null when no recent
 * check-in carries an energy rating. The string MUST NOT contain raw feeling words — only
 * an energy-level abstraction (privacy posture / no health-content leakage).
 */
export function deriveEnergyTrend(
  recent: ReadonlyArray<Pick<WellnessCheckin, "energy">>
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
   * Supersede any active `[wellness:energy-trend]` profile fact for this owner, without
   * writing a replacement. This is the consent-revocation path (#769): when
   * `wellness.ai_consent_granted` flips to false, any trend fact already sitting in chat
   * memory (an AI-prompt surface) must stop reaching prompts immediately, not merely on the
   * next check-in. Also used defensively inside `refreshEnergyTrendFact` when a check-in
   * fires while consent is withheld, so a stale fact never lingers.
   */
  async invalidateEnergyTrendFact(scopedDb: DataContextDb, ownerUserId: string): Promise<void> {
    assertDataContextDb(scopedDb);
    const active = await this.facts.listActiveFacts(scopedDb, ownerUserId);
    for (const fact of active) {
      if (fact.category === "profile" && fact.content.includes(ENERGY_TREND_TAG)) {
        await this.facts.supersedeFact(scopedDb, fact.id);
      }
    }
  }

  /**
   * Recompute the energy-trend and store it as a single owner profile fact. Supersedes
   * any prior wellness energy-trend fact so only the latest is active. Uses the memory
   * module's PUBLIC API only — never imports memory internals (module-isolation).
   *
   * `consentGranted` MUST be the effective Wellness AI-consent state
   * (`resolveEffectiveWellnessConsent` — the same helper `wellness.recentCheckIns` /
   * `wellness.medicationAdherence` gate on). This method writes into
   * `ChatMemoryFactsRepository`, which feeds chat prompts, so it is an AI-prompt surface
   * exactly like those tools (#769) and must never write while consent is withheld. When
   * consent is not granted, no new fact is derived or written; any existing active trend
   * fact is superseded instead so it stops reaching prompts.
   */
  async refreshEnergyTrendFact(
    scopedDb: DataContextDb,
    ownerUserId: string,
    consentGranted: boolean
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    if (!consentGranted) {
      await this.invalidateEnergyTrendFact(scopedDb, ownerUserId);
      return;
    }
    // Serialize concurrent refreshes for THIS owner so two near-simultaneous check-ins can't
    // each insert an energy-trend fact (leaving two active/contradictory facts). withDataContext
    // runs inside a transaction, so pg_advisory_xact_lock auto-releases on commit/rollback. The
    // second writer blocks until the first commits, then sees the now-active fact and supersedes
    // it before inserting — exactly one active energy-trend fact remains.
    await sql`SELECT pg_advisory_xact_lock(${ENERGY_TREND_LOCK_NAMESPACE}::int, ('x' || substr(md5(${ownerUserId}), 1, 8))::bit(32)::int)`.execute(
      scopedDb.db
    );
    const recent = await scopedDb.db
      .selectFrom("app.wellness_checkins")
      .select(["energy"])
      .orderBy("checked_in_at", "desc")
      .limit(7)
      .execute();

    const trend = deriveEnergyTrend(recent as Array<Pick<WellnessCheckin, "energy">>);

    await this.invalidateEnergyTrendFact(scopedDb, ownerUserId);

    if (trend) {
      await this.facts.insertFact(scopedDb, ownerUserId, {
        category: "profile",
        content: trend,
        importance: 0.6
      });
    }
  }
}
