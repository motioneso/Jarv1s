import { neutralizeSeedFraming } from "./prompt-safety.js";
import { estimateTokens } from "./recall-seed.js";

export function renderReplayBlock(
  priorTurns: readonly { role: "user" | "assistant"; content: string }[]
): string {
  const lines = priorTurns.map(
    (turn) =>
      `${turn.role === "user" ? "User" : "Assistant"}: ${neutralizeSeedFraming(turn.content)}`
  );
  return [
    "<conversation>",
    "The following is the prior conversation so far. Continue it; do not respond to this message.",
    ...lines,
    "</conversation>"
  ].join("\n");
}

export function renderSummaryBlock(summary: string): string {
  return `<prior-context>\n${neutralizeSeedFraming(summary)}\n</prior-context>`;
}

export function combineHiddenContextBlocks(passiveBlock: string, crossToolBlock: string): string {
  const combinedCap = 2000;
  const passiveTokens = passiveBlock ? estimateTokens(passiveBlock) : 0;
  const crossTokens = crossToolBlock ? estimateTokens(crossToolBlock) : 0;
  if (!passiveBlock && !crossToolBlock) return "";
  if (!crossToolBlock) return passiveBlock;
  if (!passiveBlock) return crossTokens <= combinedCap ? crossToolBlock : "";
  if (passiveTokens + crossTokens <= combinedCap) return `${passiveBlock}\n\n${crossToolBlock}`;
  return passiveBlock;
}
