import { describe, expect, it, vi } from "vitest";

import { dataContextBrand } from "@jarv1s/db";
import type { DataContextDb } from "@jarv1s/db";
import type { ProactiveMonitorProvider } from "@jarv1s/module-sdk";
import type {
  AntiSpamPolicy,
  CardRepository,
  MonitorStateRepository,
  ProactiveMonitoringPreferencesRepository
} from "@jarv1s/proactive-monitoring";
import { ProactiveScanner } from "@jarv1s/proactive-monitoring";
import type { PriorityPreferencesRepository } from "@jarv1s/priority";
import { rankPriorityCandidates } from "@jarv1s/priority";
import { defaultProactiveMonitoringPreference } from "@jarv1s/shared";

vi.mock("@jarv1s/priority", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return { ...mod, rankPriorityCandidates: vi.fn() };
});

const enabledCalendarPref = {
  ...defaultProactiveMonitoringPreference(),
  enabled: true,
  sources: {
    tasks: { enabled: false, dailyCardCap: 3 },
    calendar: { enabled: true, dailyCardCap: 3 },
    email: { enabled: false, dailyCardCap: 3 },
    notes: { enabled: false, dailyCardCap: 3 }
  }
};

// Fake DataContextDb satisfying assertDataContextDb brand check.
const fakeScopedDb = {
  [dataContextBrand]: true as const,
  db: {
    selectFrom: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockResolvedValue(undefined)
        })
      })
    })
  }
} as unknown as DataContextDb;

describe("ProactiveScanner: priority band assignment after ranking", () => {
  it("assigns band to signal by title match, not by input-array position — index-swap regression", async () => {
    // Provider returns two signals in order Alpha → Beta.
    const signalAlpha = {
      source: "calendar" as const,
      stableKey: "key-alpha",
      sourceRefHash: "hash-alpha",
      signalType: "prep_needed", // allowed for calendar
      title: "Signal Alpha",
      summary: "Alpha summary",
      occurredAt: "2026-06-28T10:00:00.000Z",
      priorityCandidate: {}
    };
    const signalBeta = {
      source: "calendar" as const,
      stableKey: "key-beta",
      sourceRefHash: "hash-beta",
      signalType: "event_changed_soon", // allowed for calendar
      title: "Signal Beta",
      summary: "Beta summary",
      occurredAt: "2026-06-28T10:00:00.000Z",
      priorityCandidate: {}
    };

    const provider: ProactiveMonitorProvider = {
      source: "calendar",
      moduleId: "calendar",
      collectSignals: vi.fn().mockResolvedValue({
        signals: [signalAlpha, signalBeta],
        nextCursor: {}
      })
    };

    // Ranker returns them REVERSED: Beta=critical, Alpha=high.
    // Index-based lookup would assign critical to Alpha (position 0 = first ranked result)
    // and high to Beta — wrong. Title-based lookup must give critical to Beta, high to Alpha.
    vi.mocked(rankPriorityCandidates).mockReturnValue([
      { source: "calendar", title: "Signal Beta", score: 100, band: "critical", reasons: [] },
      { source: "calendar", title: "Signal Alpha", score: 80, band: "high", reasons: [] }
    ]);

    const mockPrefsRepo = {
      get: vi.fn().mockResolvedValue(enabledCalendarPref)
    } as unknown as ProactiveMonitoringPreferencesRepository;

    const mockPriorityPrefsRepo = {
      get: vi.fn().mockReturnValue({ anchors: [] })
    } as unknown as PriorityPreferencesRepository;

    const mockStateRepo = {
      get: vi.fn().mockResolvedValue(null),
      advanceCursor: vi.fn().mockResolvedValue(undefined),
      recordFailure: vi.fn().mockResolvedValue(undefined)
    } as unknown as MonitorStateRepository;

    const mockCardRepo = {
      findByStableKey: vi.fn().mockResolvedValue(null),
      upsertCard: vi.fn().mockResolvedValue(undefined),
      getActiveCounts: vi.fn().mockResolvedValue({
        dailyGlobal: 0,
        dailySource: 0,
        hourlySource: 0
      })
    } as unknown as CardRepository;

    const mockAntiSpam = {
      check: vi.fn().mockResolvedValue({ allow: true, deferredUntil: null })
    } as unknown as AntiSpamPolicy;

    const scanner = new ProactiveScanner({
      preferencesRepository: mockPrefsRepo,
      priorityPreferencesRepository: mockPriorityPrefsRepo,
      monitorStateRepository: mockStateRepo,
      cardRepository: mockCardRepo,
      antiSpamPolicy: mockAntiSpam,
      getLocalePreference: vi.fn().mockResolvedValue({ timezone: "UTC" })
    });

    const result = await scanner.scan(
      fakeScopedDb,
      "00000000-0000-4000-8000-000000000001",
      "calendar",
      provider,
      "source-sync",
      new Date("2026-06-28T12:00:00.000Z")
    );

    expect(result.skipped).toBe(false);
    expect(result.cardsCreated).toBe(2);

    const upsertCalls = vi.mocked(mockCardRepo.upsertCard).mock.calls;
    expect(upsertCalls).toHaveLength(2);

    // First ranked result (Beta=critical) must produce a card for "Signal Beta" with band "critical".
    expect(upsertCalls[0]?.[1]).toMatchObject({ title: "Signal Beta", priorityBand: "critical" });
    // Second ranked result (Alpha=high) must produce a card for "Signal Alpha" with band "high".
    expect(upsertCalls[1]?.[1]).toMatchObject({ title: "Signal Alpha", priorityBand: "high" });
  });
});
