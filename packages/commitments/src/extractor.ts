import type { ExtractedCommitmentCandidate } from "@jarv1s/module-sdk";
import { passesPrefilter } from "./prefilter.js";

// Closed-over fn: caller binds model + adapter; we only supply messages.
export type ExtractorGenerateFn = (
  messages: readonly { readonly role: "user" | "assistant"; readonly content: string }[]
) => Promise<{ readonly text: string }>;

const SYSTEM_PROMPT = `You are a commitment extraction assistant. Given a text excerpt, identify all explicit commitments, deadlines, promises, and obligations. Return a JSON object with a "candidates" array. Each candidate:
- kind: "deadline" | "promise" | "obligation" | "intent"
- title: ≤100 chars
- dueLocalDate: ISO date YYYY-MM-DD if detected, else null
- counterpartyLabel: person/entity committed to (≤100 chars), else null
- evidenceExcerpt: verbatim supporting text (≤500 chars)
- confidence: "high" | "medium" | "low"
Return ONLY valid JSON. Return {"candidates":[]} if no commitments found.`;

const MAX_TEXT_LENGTH = 4000;
const MAX_OUTPUT_TOKENS = 1024;

export async function extractCommitmentsFromText(
  generate: ExtractorGenerateFn,
  text: string,
  sourceKind: string,
  occurredAt: string
): Promise<ExtractedCommitmentCandidate[]> {
  if (!passesPrefilter(text)) return [];

  const truncated = text.slice(0, MAX_TEXT_LENGTH);

  let responseText: string;
  try {
    const response = await generate([
      {
        role: "user",
        content: `${SYSTEM_PROMPT}\n\nSource: ${sourceKind} at ${occurredAt}\n\nText:\n${truncated}`
      }
    ]);
    responseText = response.text;
  } catch {
    return [];
  }

  try {
    const jsonStart = responseText.indexOf("{");
    const jsonEnd = responseText.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) return [];
    const parsed = JSON.parse(responseText.slice(jsonStart, jsonEnd + 1)) as {
      candidates?: unknown[];
    };
    if (!Array.isArray(parsed.candidates)) return [];
    return parsed.candidates.filter(isValidCandidate).map((c) => ({
      kind: c.kind,
      title: String(c.title).slice(0, 100),
      dueLocalDate: c.dueLocalDate ? String(c.dueLocalDate) : null,
      counterpartyLabel: c.counterpartyLabel ? String(c.counterpartyLabel).slice(0, 100) : null,
      evidenceExcerpt: String(c.evidenceExcerpt).slice(0, 500),
      confidence: c.confidence
    }));
  } catch {
    return [];
  }
}

function isValidCandidate(c: unknown): c is {
  kind: ExtractedCommitmentCandidate["kind"];
  title: string;
  dueLocalDate: string | null;
  counterpartyLabel: string | null;
  evidenceExcerpt: string;
  confidence: "high" | "medium" | "low";
} {
  if (typeof c !== "object" || c === null) return false;
  const obj = c as Record<string, unknown>;
  return (
    ["deadline", "promise", "obligation", "intent"].includes(String(obj["kind"])) &&
    typeof obj["title"] === "string" &&
    (obj["dueLocalDate"] === null || typeof obj["dueLocalDate"] === "string") &&
    (obj["counterpartyLabel"] === null || typeof obj["counterpartyLabel"] === "string") &&
    typeof obj["evidenceExcerpt"] === "string" &&
    ["high", "medium", "low"].includes(String(obj["confidence"]))
  );
}
