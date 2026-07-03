// Evening briefing section vocabulary (spec 2026-07-02-evening-briefing-redesign §4).
// SINGLE SOURCE OF TRUTH for these strings: the evening synthesis prompt embeds them
// VERBATIM (drift-guarded by tests/unit/briefings-evening-format.test.ts), the degraded
// fallback renders them, and the web Today surface may style them — never parse content.
export const EVENING_SECTION_HEADERS = {
  whatGotDone: "What got done",
  whatSlipped: "What slipped",
  carryingForward: "Carrying forward",
  needsYourAttention: "Needs your attention",
  tomorrow: "Tomorrow",
  newsAndSports: "News & sports"
} as const;

export type EveningSectionHeader =
  (typeof EVENING_SECTION_HEADERS)[keyof typeof EVENING_SECTION_HEADERS];

// Used only by the deterministic degraded fallback; the AI path writes two
// day-specific questions per the synthesis instructions.
export const EVENING_FALLBACK_QUESTIONS = [
  "What was today's win?",
  "What is the one thing that matters tomorrow?"
] as const;
