import { describe, expect, it } from "vitest";

import {
  composerHasExactEcho,
  isComposerEmpty
} from "../../packages/chat/src/live/composer-evidence.js";

// #1170 fixtures mirror a live claude 2.1.215 probe (2026-07-19): an attachment-shaped
// paste renders FULLY in the composer INCLUDING its interior blank line, bounded below by
// the ─── chrome line; a 40-line paste collapses to `[Pasted text #N +M lines]`.
const CHROME =
  "────────────────────────────────────────\n" +
  "  Sonnet 4.5 │ ✍️ 0% │ scratchpad │ ● high\n" +
  "  ⏵⏵ bypass permissions on (shift+tab to cycle)\n";

const ATTACHMENT_TEXT =
  "user question about resume\n" +
  "\n" +
  "<attachments>\n" +
  "The user attached files. Read each with the tool.\n" +
  '- attachmentId=abc name="resume.pdf" bytes=12345\n' +
  "</attachments>";

const ATTACHMENT_PANE =
  "❯ user question about resume\n" +
  "\n" +
  "  <attachments>\n" +
  "  The user attached files. Read each with the tool.\n" +
  '  - attachmentId=abc name="resume.pdf" bytes=12345\n' +
  "  </attachments>\n" +
  "\n" +
  CHROME;

describe("composer-evidence — multiline paste echo (#1170)", () => {
  it("matches an attachment-shaped paste whose blank line renders inside the composer", () => {
    // Pre-fix, collection broke at the first blank composer line, so the echo truncated
    // at "user question about resume" and EVERY attachment turn failed verifiedSubmit.
    expect(composerHasExactEcho("anthropic", ATTACHMENT_PANE, ATTACHMENT_TEXT)).toBe(true);
  });

  it("still rejects a genuinely different multiline composer", () => {
    expect(composerHasExactEcho("anthropic", ATTACHMENT_PANE, "different text\n\nentirely")).toBe(
      false
    );
  });

  it("stops collecting at the chrome boundary line", () => {
    // The status lines below ─── must never be swallowed into the composer text, or the
    // echo comparison would include them and always mismatch.
    expect(composerHasExactEcho("anthropic", "❯ hello\n" + CHROME, "hello")).toBe(true);
  });

  it("keeps the old blank-line stop for openai-compatible panes", () => {
    // Codex echo behavior was not probed; its collection is intentionally unchanged, so a
    // blank line still terminates it and this multiline echo does NOT match.
    const pane = "› part one\n\n  part two\n" + CHROME;
    expect(composerHasExactEcho("openai-compatible", pane, "part one\n\npart two")).toBe(false);
  });
});

describe("composer-evidence — collapsed paste placeholder (#1170)", () => {
  const placeholderPane = "❯ [Pasted text #2 +39 lines]\n" + CHROME;
  const multiline = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n");

  it("accepts the placeholder as echo evidence for multiline expected text", () => {
    expect(composerHasExactEcho("anthropic", placeholderPane, multiline)).toBe(true);
  });

  it("accepts the count-free placeholder variant", () => {
    expect(composerHasExactEcho("anthropic", "❯ [Pasted text #1]\n" + CHROME, "a\nb")).toBe(true);
  });

  it("rejects the placeholder for single-line expected text", () => {
    // Single-line pastes always render verbatim, so a placeholder there is foreign content.
    expect(composerHasExactEcho("anthropic", placeholderPane, "one liner")).toBe(false);
  });

  it("rejects the placeholder for non-anthropic providers", () => {
    const codexPane = "› [Pasted text #2 +39 lines]\n" + CHROME;
    expect(composerHasExactEcho("openai-compatible", codexPane, multiline)).toBe(false);
  });

  it("rejects placeholder-adjacent text that is not exactly the placeholder", () => {
    const pane = "❯ leftover [Pasted text #2 +39 lines]\n" + CHROME;
    expect(composerHasExactEcho("anthropic", pane, multiline)).toBe(false);
  });
});

describe("composer-evidence — emptiness with blank-tolerant collection (#1170)", () => {
  it("still reports an empty anthropic composer surrounded by blank lines", () => {
    expect(isComposerEmpty("anthropic", "❯ \n\n\n" + CHROME)).toBe(true);
  });

  it("reports a stuck multiline composer as non-empty", () => {
    expect(isComposerEmpty("anthropic", ATTACHMENT_PANE)).toBe(false);
  });
});
