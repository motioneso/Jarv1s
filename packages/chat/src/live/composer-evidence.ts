import type { ProviderKind } from "@jarv1s/ai";

// eslint-disable-next-line no-control-regex -- terminal panes contain ANSI CSI escapes by design.
const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;

export function isComposerEmpty(provider: ProviderKind, pane: string): boolean {
  const current = currentComposer(provider, pane);
  if (current === null) return false;
  if (current.text.length === 0) return true;
  // #1073: claude 2.1.183 renders its EMPTY composer as a DIM (SGR 2) placeholder
  // (`❯ Try "…"`), same as codex's openai-compatible REPL. A live 2.1.183 probe
  // confirmed real TYPED user text is never dim, so "dim first composer line ⇒ empty"
  // cannot misread a real prompt as empty. Without this the anthropic ready-gate never
  // fires and prod live chat 503s (CliChatUnavailableError). openai-compatible behavior
  // is unchanged.
  return (
    (provider === "openai-compatible" || provider === "anthropic") &&
    current.rawFirstLine.includes("\u001b[2m")
  );
}

// #1170: claude collapses LARGE pastes into a single placeholder line instead of echoing
// the text — a live 2.1.215 probe of a 40-line paste rendered exactly `[Pasted text #2
// +39 lines]` (N increments per paste within a session, M = totalLines - 1) with none of
// the pasted content visible. Exact-echo verification is therefore impossible for large
// multiline pastes; the placeholder itself is the echo evidence.
const CLAUDE_PASTED_PLACEHOLDER = /^\[Pasted text #\d+(?: \+\d+ lines)?\]$/;

export function composerHasExactEcho(
  provider: ProviderKind,
  pane: string,
  expectedText: string
): boolean {
  const current = currentComposer(provider, pane);
  if (current === null) return false;
  if (normalizeComposerText(current.text) === normalizeComposerText(expectedText)) return true;
  // #1170: accept claude's collapsed-paste placeholder as echo evidence, but ONLY for
  // multiline expected text (single-line text always renders verbatim, so a placeholder
  // there would be foreign content). This is safe against stale/foreign placeholders
  // because verifiedSubmit verifies the composer is EMPTY immediately before pasting —
  // any placeholder observed after our paste can only be our paste. We deliberately do
  // NOT match the `+M lines` count against the expected line count: the CLI's counting
  // semantics are undocumented and a drift there would resurrect the exact 503 outage
  // this fixes.
  return (
    provider === "anthropic" &&
    expectedText.includes("\n") &&
    CLAUDE_PASTED_PLACEHOLDER.test(current.text)
  );
}

function currentComposer(
  provider: ProviderKind,
  pane: string
): { readonly rawFirstLine: string; readonly text: string } | null {
  const glyph = provider === "anthropic" ? "❯" : provider === "openai-compatible" ? "›" : ">";
  const lines = pane.split("\n");
  let index = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (
      stripAnsi(lines[i] ?? "")
        .trimStart()
        .startsWith(glyph)
    ) {
      index = i;
      break;
    }
  }
  if (index < 0) return null;

  const rawFirstLine = lines[index] ?? "";
  const first = stripAnsi(rawFirstLine).trimStart().slice(glyph.length).trimStart();
  const composerLines = [first];
  for (let i = index + 1; i < lines.length; i += 1) {
    const line = stripAnsi(lines[i] ?? "").trim();
    if (/^(?:─+|\? for shortcuts|esc to |ctrl\+)/i.test(line)) break;
    // #1170: claude renders interior BLANK lines of a multiline paste inside the composer
    // (probed live on 2.1.215 with an attachment-shaped payload — the `\n\n` before the
    // <attachments> block appears as a blank composer line above the ─── chrome boundary).
    // Breaking on the first blank line truncated the collected echo at that blank, so
    // composerHasExactEcho could NEVER match an attachment turn and every one 503'd.
    // For anthropic, collect through blanks and stop only at the chrome boundary; other
    // providers keep the old blank-line stop (codex chrome below the composer is not
    // guaranteed to match the boundary regex, and its echo behavior was not probed).
    if (!line && provider !== "anthropic") break;
    composerLines.push(line);
  }
  // Trailing blanks are padding between the composer text and the chrome, not content.
  while (composerLines.length > 0 && composerLines[composerLines.length - 1] === "") {
    composerLines.pop();
  }
  return { rawFirstLine, text: composerLines.join(" ").trim() };
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

function normalizeComposerText(text: string): string {
  return text.replace(/\s+/g, "");
}
