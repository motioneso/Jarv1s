# Email Reply MIME CRLF Hardening Implementation Plan

> **For agentic workers:** driven task-by-task under `coordinated-build` (execution sub-skills are disabled in this repo). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent CRLF header injection in `buildReplyMime` by stripping `\r`/`\n` from `To:` and `Subject:` header values before rendering.

**Architecture:** Add one small, private helper `stripHeaderValue` in `packages/email/src/reply-mime.ts` that removes CR and LF from a string. Apply it to the `to` and `subject` header values inside `buildReplyMime`. The body is untouched. No new dependency.

**Tech Stack:** TypeScript, vitest.

## Global Constraints

- Strip `\r` and `\n` from MIME header values before rendering `To:` and `Subject:` (issue #659 scope).
- Keep the body unchanged except for existing MIME formatting — the existing test asserts the body retains embedded `\n`.
- Prefer one small helper in `packages/email/src/reply-mime.ts`; **no new dependency**.
- Security-tier change: defensive, minimal surface, no behavior change for benign input.
- No schema, RLS, connector credential, job payload, or UI expansion.
- Targeted test command: `pnpm exec vitest run tests/unit/email-reply-mime.test.ts`.
- Required checks before wrap-up: `pnpm format:check && pnpm lint && pnpm typecheck` plus the targeted test.

---

### Task 1: Strip CR/LF from reply MIME header values

**Files:**

- Modify: `packages/email/src/reply-mime.ts:35-44` (`buildReplyMime`) — add helper + apply it.
- Test: `tests/unit/email-reply-mime.test.ts` (append negative tests to the existing `describe("buildReplyMime")` block).

**Interfaces:**

- Consumes: existing `buildReplyMime({ to, subject, body }): string`, unchanged signature.
- Produces: no new public export. Private helper `stripHeaderValue(value: string): string` internal to the module.

- [ ] **Step 1: Write the failing negative tests**

Append to `tests/unit/email-reply-mime.test.ts` inside the existing `describe("buildReplyMime", ...)` block (before its closing `});`):

```ts
it("strips CR/LF from the recipient so a sender cannot inject headers", () => {
  const raw = buildReplyMime({
    to: "alice@example.com\r\nBcc: attacker@evil.com",
    subject: "Re: Hi",
    body: "Hello"
  });
  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  expect(decoded).not.toContain("Bcc:");
  expect(decoded).toContain("To: alice@example.comBcc: attacker@evil.com");
  // header block still terminates with exactly one blank line before the body
  expect(decoded).toContain("Content-Type: text/plain; charset=UTF-8\n\nHello");
});

it("strips CR/LF from the subject so a cached subject cannot inject headers", () => {
  const raw = buildReplyMime({
    to: "a@b.com",
    subject: "Re: Hi\r\nBcc: attacker@evil.com\r\nX-Evil: 1",
    body: "Hello"
  });
  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  expect(decoded).not.toContain("Bcc:");
  expect(decoded).not.toContain("X-Evil:");
  expect(decoded).toContain("Subject: Re: HiBcc: attacker@evil.comX-Evil: 1");
});

it("strips lone CR and lone LF, not only CRLF pairs", () => {
  const raw = buildReplyMime({
    to: "a@b.com\rBcc: x@y.com",
    subject: "S\nInjected: 1",
    body: "Body"
  });
  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  expect(decoded).not.toContain("Bcc:");
  expect(decoded).not.toContain("Injected:");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/email-reply-mime.test.ts`
Expected: FAIL — the three new tests fail (decoded output still contains `Bcc:`/`Injected:` on their own lines). The 7 pre-existing tests pass.

- [ ] **Step 3: Add the helper and apply it**

In `packages/email/src/reply-mime.ts`, add the helper above `buildReplyMime` and use it for the two interpolated header values:

```ts
/**
 * Remove CR and LF from a value destined for an RFC822 header. Reply header values
 * (recipient, subject) are derived from cached inbound email; stripping line breaks
 * closes a header-injection vector (e.g. a smuggled `Bcc:`) even if upstream ingestion
 * ever fails to normalize them. Header folding is not needed for our short values.
 */
function stripHeaderValue(value: string): string {
  return value.replace(/[\r\n]/g, "");
}
```

Then change the `headers` array in `buildReplyMime`:

```ts
const headers = [
  `To: ${stripHeaderValue(input.to)}`,
  `Subject: ${stripHeaderValue(input.subject)}`,
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=UTF-8"
];
```

Leave `const message = ...` and the base64url return unchanged (body stays verbatim).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/email-reply-mime.test.ts`
Expected: PASS — all 10 tests green (7 original + 3 new).

- [ ] **Step 5: Commit**

```bash
git add packages/email/src/reply-mime.ts tests/unit/email-reply-mime.test.ts
git commit -m "fix(email): strip CR/LF from reply MIME header values (#659)"
```

---

## Self-Review

**Spec coverage:**

- "Strip `\r` and `\n` from header values before rendering `To:`/`Subject:`" → Task 1, Step 3 helper applied to both. ✓
- "Add negative tests proving CR/LF cannot inject headers such as `Bcc:`" → Task 1, Step 1 (three tests: recipient injection, subject injection, lone CR/LF). ✓
- "Keep the body unchanged" → body interpolation untouched; existing verbatim-body test still asserted; new test asserts the `\n\nHello` boundary. ✓
- "One small helper, no new dependency" → `stripHeaderValue`, pure regex, no import. ✓

**Placeholder scan:** none — all code shown verbatim.

**Type consistency:** `stripHeaderValue(value: string): string` used consistently; `buildReplyMime` signature unchanged.
