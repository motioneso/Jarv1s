import { describe, expect, it } from "vitest";
import {
  sanitizePlainText,
  parseAnswerMarkers,
  stripAnswerMarkers,
  crossToolItemToSupport,
  memoryItemToSupport,
  finalizeProvenance,
  toSupportCard,
  readStoredProvenance,
  provenanceCards
} from "../../packages/chat/src/live/answer-provenance.js";
import type { CrossToolEvidenceItem } from "../../packages/chat/src/live/cross-tool-reasoning.js";
import type { MemoryRecallItem } from "@jarv1s/memory";
import type {
  AnswerProvenanceState,
  AnswerSourceSupport,
  AnswerProvenanceMetadataV1
} from "@jarv1s/shared";

// ── sanitizePlainText ─────────────────────────────────────────────────────────
describe("sanitizePlainText", () => {
  it("strips NUL and other control chars except tab/newline/CR", () => {
    expect(sanitizePlainText("hello\x00world")).toBe("helloworld");
    expect(sanitizePlainText("tab\there")).toBe("tab\there");
  });

  it("caps at 240 chars for snippets when explicitly capped", () => {
    const long = "a".repeat(300);
    expect(sanitizePlainText(long, 240).length).toBe(240);
  });

  it("preserves normal text unchanged", () => {
    expect(sanitizePlainText("Email: Sarah / Pricing")).toBe("Email: Sarah / Pricing");
  });
});

// ── parseAnswerMarkers ────────────────────────────────────────────────────────
describe("parseAnswerMarkers", () => {
  it("extracts valid [[SN]] markers", () => {
    expect(parseAnswerMarkers("According to [[S1]] and [[S2]] ...")).toEqual(["S1", "S2"]);
  });

  it("deduplicates repeated markers", () => {
    expect(parseAnswerMarkers("[[S1]] and [[S1]] again")).toEqual(["S1"]);
  });

  it("ignores malformed markers", () => {
    expect(parseAnswerMarkers("[[s1]] [[]] [[S-1]] [[TOOLONG12]]")).toEqual([]);
  });

  it("returns empty array when no markers", () => {
    expect(parseAnswerMarkers("plain text")).toEqual([]);
  });
});

// ── stripAnswerMarkers ────────────────────────────────────────────────────────
describe("stripAnswerMarkers", () => {
  it("removes valid markers that exist in validIds set", () => {
    const valid = new Set(["S1", "S2"]);
    expect(stripAnswerMarkers("See [[S1]] for details [[S3]]", valid)).toBe(
      "See  for details [[S3]]"
    );
  });

  it("leaves unknown support ids unchanged", () => {
    const valid = new Set(["S1"]);
    expect(stripAnswerMarkers("[[S99]] text", valid)).toBe("[[S99]] text");
  });
});

// ── crossToolItemToSupport ────────────────────────────────────────────────────
describe("crossToolItemToSupport", () => {
  const emailItem: CrossToolEvidenceItem = {
    source: "email",
    title: "Pricing discussion",
    summary: "Sarah asked about the Q3 pricing before the review.",
    sourceLabel: "Email: Sarah / Pricing discussion",
    occurredAt: "2026-06-01T10:00:00Z",
    relevance: "high"
  };

  it("maps email item to AnswerSourceSupport", () => {
    const support = crossToolItemToSupport(emailItem, 0);
    expect(support.supportId).toBe("S1");
    expect(support.sourceKind).toBe("email");
    expect(support.state).toBe("unverified_context");
    expect(support.canDereference).toBe(false);
    expect(support.snippet).toBeDefined();
    expect(support.snippet!.length).toBeLessThanOrEqual(240);
  });

  it("assigns sequential support ids", () => {
    const calItem: CrossToolEvidenceItem = {
      source: "calendar",
      title: "Team standup",
      summary: "Daily standup at 9am",
      sourceLabel: "Calendar: Jun 28, 9:00 AM",
      startsAt: "2026-06-28T09:00:00Z",
      relevance: "medium"
    };
    expect(crossToolItemToSupport(calItem, 2).supportId).toBe("S3");
  });

  it("strips control characters from title and snippet", () => {
    const dirtyItem: CrossToolEvidenceItem = {
      source: "notes",
      title: "Note\x00Title",
      summary: "content\x01here",
      sourceLabel: "Notes: secret.md",
      relevance: "low"
    };
    const support = crossToolItemToSupport(dirtyItem, 0);
    expect(support.title).toBe("NoteTitle");
    expect(support.snippet).not.toContain("\x01");
  });
});

// ── memoryItemToSupport ───────────────────────────────────────────────────────
describe("memoryItemToSupport", () => {
  const confirmedFact: MemoryRecallItem = {
    kind: "fact",
    id: "m1",
    title: "Prefers async meetings",
    text: "User prefers async over sync meetings",
    score: 0.9,
    confidence: 0.95,
    confidenceTier: "confirmed",
    provenance: "confirmed",
    status: "active",
    validFrom: null,
    validTo: null,
    staleAt: null,
    sources: []
  };

  it("maps confirmed memory to confirmed_source state", () => {
    const support = memoryItemToSupport(confirmedFact, 0);
    expect(support.state).toBe("confirmed_source");
    expect(support.sourceKind).toBe("memory");
    expect(support.confidenceTier).toBe("confirmed");
  });

  const inferredFact: MemoryRecallItem = {
    ...confirmedFact,
    provenance: "inferred",
    confidenceTier: "medium",
    confidence: 0.6
  };

  it("maps inferred memory to inferred_memory state", () => {
    expect(memoryItemToSupport(inferredFact, 0).state).toBe("inferred_memory");
  });

  it("uses source-kind from first source when available", () => {
    const noteSourceItem: MemoryRecallItem = {
      ...confirmedFact,
      sources: [
        {
          id: "src1",
          sourceKind: "note",
          sourceRef: "ref/secret",
          sourceLabel: "Notes: journal",
          excerpt: "text",
          occurredAt: null
        }
      ]
    };
    const support = memoryItemToSupport(noteSourceItem, 0);
    expect(support.sourceKind).toBe("note");
    expect(support.sourceLabel).toBe("Notes: journal");
  });
});

// ── finalizeProvenance ────────────────────────────────────────────────────────
describe("finalizeProvenance", () => {
  const makeSupport = (
    id: string,
    state: AnswerProvenanceState = "unverified_context"
  ): AnswerSourceSupport => ({
    supportId: id,
    sourceKind: "memory",
    sourceLabel: `Label ${id}`,
    title: `Title ${id}`,
    state,
    canDereference: false
  });

  it("caps at 8 items and increments omittedCount", () => {
    const candidates = Array.from({ length: 10 }, (_, i) => makeSupport(`S${i + 1}`));
    const result = finalizeProvenance(candidates, ["S1"]);
    expect(result.supportItems.length).toBe(8);
    expect(result.omittedCount).toBe(2);
  });

  it("keeps cited items before uncited context-checked items when trimming", () => {
    const candidates = [
      ...Array.from({ length: 9 }, (_, i) => makeSupport(`S${i + 1}`)),
      makeSupport("S10", "confirmed_source")
    ];
    const result = finalizeProvenance(candidates, ["S10"]);
    expect(result.supportItems.map((s) => s.supportId)).toContain("S10");
    expect(result.citedSupportIds).toContain("S10");
  });

  it("citedSupportIds contains only ids present in supportItems", () => {
    const candidates = [makeSupport("S1"), makeSupport("S2")];
    const result = finalizeProvenance(candidates, ["S1", "S99"]);
    expect(result.citedSupportIds).toEqual(["S1"]);
    expect(result.citedSupportIds).not.toContain("S99");
  });

  it("contextCheckedCount counts uncited context items", () => {
    const candidates = [
      makeSupport("S1"),
      makeSupport("S2"),
      makeSupport("S3", "confirmed_source")
    ];
    const result = finalizeProvenance(candidates, ["S3"]);
    expect(result.contextCheckedCount).toBe(2);
  });
});

// ── toSupportCard ─────────────────────────────────────────────────────────────
describe("toSupportCard", () => {
  it("drops citationToken from AnswerSourceSupport", () => {
    const support: AnswerSourceSupport = {
      supportId: "S1",
      sourceKind: "email",
      sourceLabel: "Email",
      title: "Test",
      state: "confirmed_source",
      canDereference: true,
      citationToken: "secret-token"
    };
    const card = toSupportCard(support);
    expect((card as unknown as Record<string, unknown>).citationToken).toBeUndefined();
    expect(card.supportId).toBe("S1");
  });
});

// ── readStoredProvenance ──────────────────────────────────────────────────────
describe("readStoredProvenance", () => {
  it("returns null when no provenance in tool_metadata", () => {
    expect(readStoredProvenance({ selectedTools: [] })).toBeNull();
  });

  it("returns null when version is not 1", () => {
    expect(readStoredProvenance({ answerProvenanceV1: { version: 2 } })).toBeNull();
  });

  it("returns null when answerProvenanceV1 is not a valid object", () => {
    expect(readStoredProvenance({ answerProvenanceV1: "bad" })).toBeNull();
    expect(readStoredProvenance({ answerProvenanceV1: null })).toBeNull();
  });

  it("returns parsed metadata when valid", () => {
    const meta: AnswerProvenanceMetadataV1 = {
      version: 1,
      citedSupportIds: ["S1"],
      supportItems: [],
      contextCheckedCount: 0,
      omittedCount: 0
    };
    const result = readStoredProvenance({ answerProvenanceV1: meta });
    expect(result?.version).toBe(1);
    expect(result?.citedSupportIds).toEqual(["S1"]);
  });
});

// ── provenanceCards ───────────────────────────────────────────────────────────
describe("provenanceCards", () => {
  it("strips citationToken from all items", () => {
    const meta: AnswerProvenanceMetadataV1 = {
      version: 1,
      citedSupportIds: ["S1"],
      supportItems: [
        {
          supportId: "S1",
          sourceKind: "email",
          sourceLabel: "Email",
          title: "Test",
          state: "confirmed_source",
          canDereference: false,
          citationToken: "tok"
        }
      ],
      contextCheckedCount: 0,
      omittedCount: 0
    };
    const cards = provenanceCards(meta);
    expect(cards.length).toBe(1);
    expect((cards[0] as unknown as Record<string, unknown>).citationToken).toBeUndefined();
  });
});
