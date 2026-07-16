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

export function composerHasExactEcho(
  provider: ProviderKind,
  pane: string,
  expectedText: string
): boolean {
  const current = currentComposer(provider, pane);
  return (
    current !== null && normalizeComposerText(current.text) === normalizeComposerText(expectedText)
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
    if (!line || /^(?:─+|\? for shortcuts|esc to |ctrl\+)/i.test(line)) break;
    composerLines.push(line);
  }
  return { rawFirstLine, text: composerLines.join(" ").trim() };
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

function normalizeComposerText(text: string): string {
  return text.replace(/\s+/g, "");
}
