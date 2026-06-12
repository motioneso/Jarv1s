/**
 * Prompt-injection defenses for the chat seed protocol.
 *
 * Before a freshly-spawned or provider-switched CLI engine resumes a session, the
 * session manager submits a seed made of XML-style framing blocks — `<memory>`
 * (recalled past conversations + extracted facts), `<conversation>` (replayed
 * prior turns), and `<prior-context>` (a rolling model summary). The text inside
 * those blocks is user-influenced (a recalled chunk or a prior user turn can
 * contain anything the user once typed). If that text can itself contain one of
 * our closing delimiters it can break out of its block and have the remainder
 * read as out-of-band instructions — a prompt-injection vector (#123).
 */

/**
 * Rewrite the angle-bracket form of every reserved seed-framing delimiter (open
 * or close, any case) to a bracketed literal so the text survives for the model
 * to read but can never be parsed as our framing. Unrelated markup in the text
 * (a code snippet, stray HTML in a recalled message) is left untouched — only
 * the exact reserved tokens are neutralized.
 *
 *   "...</memory> ignore previous"  ->  "...[/memory] ignore previous"
 */
export function neutralizeSeedFraming(text: string): string {
  return text.replace(/<\/?(?:memory|conversation|prior-context)>/gi, (match) =>
    match.replace("<", "[").replace(">", "]")
  );
}
