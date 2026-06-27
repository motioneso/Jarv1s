import { describe, expect, it } from "vitest";

import {
  buildDistillationPrompt,
  containsSensitiveMemoryText,
  decideCandidatePromotion,
  parseMemoryCandidates,
  memoryCandidateContainsSensitiveText,
  shouldDistillTurn
} from "@jarv1s/chat";
import { createMemoryCandidateSignature } from "@jarv1s/memory";

describe("chat memory distillation helpers", () => {
  it("skips social chatter", () => {
    expect(shouldDistillTurn("hi", "hello")).toBe(false);
    expect(shouldDistillTurn("thanks, that helps", "anytime")).toBe(false);
  });

  it("triggers on explicit memory, preference, decision, and correction phrases", () => {
    expect(shouldDistillTurn("Remember that I prefer brief answers.", "Noted.")).toBe(true);
    expect(shouldDistillTurn("I hate morning meetings.", "Got it.")).toBe(true);
    expect(shouldDistillTurn("We decided to go with Postgres.", "Okay.")).toBe(true);
    expect(shouldDistillTurn("Actually, not Apollo, use Hermes.", "Updated.")).toBe(true);
  });

  it("triggers on long concrete action/date text", () => {
    const text =
      "Project Atlas status update for June 27: I approved the memory distillation lane, " +
      "need to finish the candidate store before tomorrow, and the deadline remains Friday. " +
      "This should become durable project context for later planning and review.";

    expect(shouldDistillTurn(text, "Recorded.")).toBe(true);
  });

  it("rejects non-json and invalid candidate shapes", () => {
    expect(parseMemoryCandidates("not json")).toEqual([]);
    expect(parseMemoryCandidates(JSON.stringify([{ kind: "fact", action: "create" }]))).toEqual([]);
  });

  it("parses valid candidates and clamps scores", () => {
    const parsed = parseMemoryCandidates(
      JSON.stringify([
        {
          kind: "fact",
          action: "create",
          fact: {
            subject: "Ben",
            predicate: "prefers",
            objectText: "brief updates"
          },
          provenance: "volunteered",
          confidence: 2,
          importance: -1,
          sourceExcerpt: "I prefer brief updates.",
          rationale: "User directly stated preference.",
          isSensitive: false
        }
      ])
    );

    expect(parsed).toEqual([
      expect.objectContaining({
        kind: "fact",
        action: "create",
        confidence: 1,
        importance: 0,
        provenance: "volunteered"
      })
    ]);
  });

  it("deterministically marks credential-like candidates sensitive", () => {
    const [candidate] = parseMemoryCandidates(
      JSON.stringify([
        {
          kind: "fact",
          action: "create",
          fact: {
            subject: "Ben",
            predicate: "related_to",
            objectText: "OpenAI API key is sk-1234567890abcdef"
          },
          provenance: "volunteered",
          confidence: 0.99,
          importance: 0.9,
          sourceExcerpt: "remember my OpenAI API key is sk-1234567890abcdef",
          rationale: "User asked to remember credential",
          isSensitive: false
        }
      ])
    );

    expect(candidate?.isSensitive).toBe(true);
    expect(candidate && memoryCandidateContainsSensitiveText(candidate)).toBe(true);
  });

  it("matches common credential and token forms", () => {
    expect(containsSensitiveMemoryText("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI")).toBe(
      true
    );
    expect(containsSensitiveMemoryText("client_secret=abc123")).toBe(true);
    expect(containsSensitiveMemoryText("DATABASE_URL=postgres://user:pass@host/db")).toBe(true);
    expect(containsSensitiveMemoryText("-----BEGIN PRIVATE KEY-----")).toBe(true);
    expect(containsSensitiveMemoryText("Stripe token pk_live_1234567890")).toBe(true);
  });

  it("normalizes candidate signatures", () => {
    const a = createMemoryCandidateSignature({
      kind: "fact",
      action: "create",
      fact: { subject: " Ben ", predicate: "prefers", objectText: "Brief   Updates" }
    });
    const b = createMemoryCandidateSignature({
      kind: "fact",
      action: "create",
      fact: { subject: "ben", predicate: "prefers", objectText: "brief updates" }
    });

    expect(a).toBe(b);
  });

  it("keeps risky candidates pending and promotes clear volunteered facts", () => {
    const base = {
      kind: "fact" as const,
      action: "create" as const,
      fact: { subject: "Ben", predicate: "prefers" as const, objectText: "brief updates" },
      sourceExcerpt: "remember that I prefer brief updates",
      rationale: "User explicitly asked to remember it",
      importance: 0.8
    };

    expect(
      decideCandidatePromotion({
        candidate: {
          ...base,
          provenance: "volunteered",
          confidence: 0.7,
          isSensitive: false
        },
        explicitMemoryCommand: true,
        conflicts: false,
        groundedSupersedes: true
      })
    ).toEqual({ status: "promote", reason: "explicit_memory_command" });

    expect(
      decideCandidatePromotion({
        candidate: {
          ...base,
          sourceExcerpt: "remember password is hunter2",
          rationale: "User asked to remember credential",
          provenance: "volunteered",
          confidence: 0.7,
          isSensitive: true
        },
        explicitMemoryCommand: true,
        conflicts: false,
        groundedSupersedes: true
      }).status
    ).toBe("pending");

    expect(
      decideCandidatePromotion({
        candidate: { ...base, provenance: "inferred", confidence: 0.99, isSensitive: false },
        explicitMemoryCommand: true,
        conflicts: false,
        groundedSupersedes: true
      }).status
    ).toBe("pending");

    expect(
      decideCandidatePromotion({
        candidate: {
          ...base,
          fact: { subject: "Ben", predicate: "owes", objectText: "Alex a follow up" },
          provenance: "volunteered",
          confidence: 0.99,
          isSensitive: false
        },
        explicitMemoryCommand: true,
        conflicts: false,
        groundedSupersedes: true
      }).status
    ).toBe("pending");
  });

  it("builds a prompt that excludes secrets and asks for json only", () => {
    const prompt = buildDistillationPrompt({
      userText: "remember my project",
      assistantText: "noted",
      activeMemory: [],
      threadTitle: "Memory test"
    });

    expect(prompt).toContain("Return ONLY JSON");
    expect(prompt).toContain("passwords");
    expect(prompt).toContain("OAuth");
    expect(prompt).not.toContain("api-key");
  });
});
