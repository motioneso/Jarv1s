# Anthropic Composer Empty Detection

- **Issue:** #1073
- **Status:** Approved fix direction; implementation blocked on one live-REPL discriminator check
- **Scope:** Anthropic live CLI chat composer readiness only

## Problem and root cause

Production live chat `POST /api/chat/turn` returns HTTP 503 `CliChatUnavailableError` when the
interactive CLI engine uses the Anthropic provider. This is the second defect in the incident;
#1071 already fixed the separate permission-mode defect and is outside this design.

`isComposerEmpty(provider, pane)` in `packages/chat/src/live/composer-evidence.ts` treats a non-empty
dim placeholder as empty only for `openai-compatible`. Claude Code 2.1.183 now renders its idle
composer as the dim placeholder `❯ Try "how do I log an error?"`. `currentComposer("anthropic",
pane)` therefore returns non-empty text, so the ready poll in `CliChatEngineImpl.submit()` never
passes. It times out as `VerifiedSubmitError("unavailable")`, becomes `CliChatUnavailableError`, and
returns 503 before the prompt is pasted.

## Approach

Keep `currentComposer` and `composerHasExactEcho` unchanged. Change only the empty-composer decision
for Anthropic after confirming how Claude Code 2.1.183 styles real typed input.

### Preferred discriminator: dim SGR

If a live Claude Code 2.1.183 capture confirms that typed composer text is not rendered with ANSI dim
SGR (`\u001b[2m`), allow the existing dim-placeholder rule for `anthropic` as well as
`openai-compatible`.

This is the preferred implementation because it uses the terminal's semantic distinction between
placeholder and user input, supports placeholder copy changes, and requires only the existing
`rawFirstLine` evidence. The `openai-compatible` branch must retain its current behavior exactly;
the change only adds Anthropic to the set of providers allowed to interpret dim text as empty.

The ordering remains fail closed:

1. No detected composer returns `false`.
2. A composer with no text returns `true` for every provider, as today.
3. Existing `openai-compatible` dim handling remains unchanged.
4. Anthropic dim handling is added only after the live typed-text check proves dim cannot identify a
   real typed prompt.
5. Other non-empty composer text returns `false`.

### Safer fallback: exact Anthropic placeholder

If real typed Claude Code 2.1.183 composer text can also contain dim SGR, do not add a provider-wide
Anthropic dim allowance. Instead, treat the Anthropic composer as empty only when both conditions
hold:

- `rawFirstLine` contains ANSI dim SGR; and
- the ANSI-stripped composer text exactly equals `Try "how do I log an error?"`.

The existing `openai-compatible` condition remains separate and unchanged. Exact matching is
deliberately version-specific and fail closed: a future placeholder-copy change may make readiness
fail again, but it cannot cause a real user prompt to be mistaken for an empty composer and
overwritten or submitted incorrectly.

## Files touched

- `packages/chat/src/live/composer-evidence.ts` — extend only the Anthropic empty-composer
  discriminator selected by the live check; do not change parsing or echo confirmation.
- `tests/unit/cli-chat-engine.test.ts` — add real Claude Code 2.1.183 empty and typed pane captures to
  the existing observed-composer-evidence tests.

No new helper, abstraction, fixture framework, or production dependency is needed. The two captured
pane strings can be named test fixtures in the existing unit file.

## Assumptions to verify

- **Open question before implementation:** In a real Claude Code 2.1.183 pane, is user-typed composer
  text non-dim while the idle placeholder is dim? Capture the same ready REPL once while idle and
  once after typing a distinctive unsent prompt, preserving ANSI escapes.
- If typed text is non-dim, implement the preferred dim-SGR discriminator.
- If typed text can be dim, implement the exact-placeholder fallback instead.
- The supplied production capture establishes the Anthropic idle placeholder and footer boundary;
  root cause does not need re-investigation.

## Testing

### Unit fixtures

Add two sanitized, byte-faithful Claude Code 2.1.183 pane captures to
`tests/unit/cli-chat-engine.test.ts`:

- idle Anthropic composer containing the dim `Try "how do I log an error?"` placeholder and the
  `? for shortcuts · ← for agents` footer boundary;
- the same Anthropic composer with a distinctive unsent typed prompt, using the ANSI styling observed
  in the live confirmation.

Assertions:

- `isComposerEmpty("anthropic", emptyPane)` returns `true`;
- `isComposerEmpty("anthropic", typedPane)` returns `false`;
- `composerHasExactEcho("anthropic", typedPane, typedPrompt)` returns `true`;
- the existing `openai-compatible` empty-placeholder and typed-text assertions remain unchanged and
  passing.

Root unit tests are skipped by the local non-DB gate, so run this file explicitly:

```bash
pnpm exec vitest run tests/unit/cli-chat-engine.test.ts
```

Run the repository's required formatting and relevant verification gates after the focused test.

### End-to-end UAT

The exit criterion is a real-instance Anthropic live-chat UAT, because this is runtime UI behavior:

1. Start from an idle, ready Claude Code 2.1.183 REPL showing the empty placeholder.
2. Send a prompt through production `POST /api/chat/turn` using the interactive CLI engine and
   Anthropic provider.
3. Verify the request returns HTTP 200, the prompt appears in the Claude composer before submission,
   and the response contains a real model reply.
4. Confirm the flow does not return `CliChatUnavailableError` and does not rely on a bypass-warning
   or permission-mode change.

Unit tests alone do not close #1073.

## Non-goals

- Changing or diagnosing the Codex/`openai-compatible` path; it is unconfirmed as broken and out of
  scope.
- Revisiting permission mode, bypass permissions, trust-wizard handling, or #1071.
- Refactoring `currentComposer`, `composerHasExactEcho`, `CliChatEngineImpl.submit()`, polling, error
  mapping, provider glyph handling, or footer-boundary parsing.
- Adding generalized placeholder registries, provider configuration, or new dependencies.

## Risks

- A broad Anthropic dim check would be unsafe if Claude renders typed text dim. The required live
  capture decides whether that implementation is allowed.
- The exact-placeholder fallback can regress when Claude changes placeholder copy. This is an
  accepted fail-closed trade-off until a stable terminal semantic discriminator is available.
- Sanitizing the fixture too aggressively could remove the ANSI evidence that caused the defect.
  Preserve escape sequences and relevant boundaries while excluding unrelated private terminal
  content.
- Parser changes could accidentally affect wrapped prompt echo detection. Keeping `currentComposer`
  unchanged and asserting `composerHasExactEcho` against the typed fixture protects that behavior.
