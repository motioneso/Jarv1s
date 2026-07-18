/**
 * Prompt-injection defenses for the chat seed protocol.
 *
 * Before a freshly-spawned or provider-switched CLI engine resumes a session, the
 * session manager submits a seed made of XML-style framing blocks — `<memory>`
 * (recalled past conversations + extracted facts), `<conversation>` (replayed
 * prior turns), and `<prior-context>` (a rolling summary that is a verbatim
 * concatenation of stored assistant message bodies). The text inside those blocks
 * is user-influenced — a recalled chunk or prior user turn can contain anything
 * the user once typed, and the rolling summary can echo whatever the user steered
 * the model to emit. If that text can itself contain one of our closing
 * delimiters it can break out of its block and have the remainder read as
 * out-of-band instructions — a
 * prompt-injection vector (#123).
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
  return text.replace(
    /<\/?(?:memory|conversation|prior-context|retrieved_context|cross_tool_context|page_context|attachments)>/gi,
    (match) => match.replace("<", "[").replace(">", "]")
  );
}
