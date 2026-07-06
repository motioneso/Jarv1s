# Plan — Slice D: IMAP Send via EmailWriteProvider

**Issue:** #647  
**Spec:** `docs/superpowers/specs/2026-06-30-generic-imap-email-connector-design.md` §8  
**Branch:** `coord/647-imap-send`  
**Risk tier:** security  
**Status:** plan-ready

## Premises verified (2026-07-01)

All spec premises hold on current branch:

- ✅ #214 email write tools exist: `packages/chat/src/email-write-impl.ts` (Google-only)
- ✅ `EmailWriteService` contract exists: `packages/email/src/email-write-service.ts`
- ✅ IMAP credential infrastructure exists: `packages/connectors/src/imap-*.ts`
- ✅ IMAP presets have SMTP config: `smtpHost/Port/Security` for all providers
- ❌ `EmailWriteProvider` abstraction doesn't exist yet — this is Slice D's core work

## Scope

Generalize email send behind a provider-abstracted `EmailWriteProvider` seam:

- Extract Gmail-impl from `packages/chat/src/email-write-impl.ts` into `GoogleEmailWriteProvider`
- Create `ImapEmailWriteProvider` (SMTP send + APPEND draft/Sent)
- Rewrite `email-write-impl.ts` to dispatch by `connector_account_id` provider type
- Preserve all security invariants: secrets never escape, metadata-only payloads, provider-agnostic AI

## Exit criteria

1. `EmailWriteProvider` type exported from `packages/email/src/` with `saveDraft()`/`send()`
2. `GoogleEmailWriteProvider` implements the seam (behavior unchanged)
3. `ImapEmailWriteProvider` implements the seam:
   - `saveDraft()` = IMAP APPEND to `\Drafts`
   - `send()` = SMTP submission + IMAP APPEND to `\Sent`
4. `packages/chat/src/email-write-impl.ts` dispatches by provider type
5. IMAP accounts no longer return "unsupported" — draft/send work end-to-end
6. All tests pass: unit (providers) + integration (GreenMail protocol harness)
7. Security audit: creds never in HTTP/logs/payloads/exports/prompts

## Tasks (TDD, bite-sized, green per commit)

### 1. Create the EmailWriteProvider abstraction

**File:** `packages/email/src/email-write-provider.ts`

- Export `interface EmailWriteProvider` with `saveDraft()` and `send()`
- Both methods take `ReplyInput`-derived params + credentials, return `EmailWriteResult`
- Document security constraints: secrets never escape, metadata-only
- Export from `packages/email/src/index.ts`

### 2. Extract GoogleEmailWriteProvider

**File:** `packages/connectors/src/google-email-write-provider.ts`

- Move Gmail-specific logic from `packages/chat/src/email-write-impl.ts`
- Implement `EmailWriteProvider` interface
- Dependencies: `GoogleApiClient`, `GoogleConnectionService`, `ConnectorsRepository`
- Keep existing error handling, scope checks, feature grants
- Export from `packages/connectors/src/index.ts`

### 3. Create ImapEmailWriteProvider (SMTP + APPEND)

**File:** `packages/connectors/src/imap-email-write-provider.ts`

- Implement `EmailWriteProvider` interface
- Dependencies: `ImapConnectionSecret`, SMTP client library
- `saveDraft()`: IMAP APPEND raw RFC822 to `\Drafts` folder
- `send()`:
  - Connect to SMTP (implicit_tls/starttls per preset)
  - Authenticate with username/password
  - Submit message
  - IMAP APPEND to `\Sent` folder
- Error handling: map SMTP/IMAP failures to secret-free `EmailWriteResult`
- Export from `packages/connectors/src/index.ts`

### 4. Add SMTP client dependency

**File:** `packages/connectors/package.json`

- Add `smtp-client` or similar library (check existing deps)
- Prefer libraries that support implicit_tls/starttls modes

### 5. Rewrite email-write-impl.ts as provider dispatcher

**File:** `packages/chat/src/email-write-impl.ts`

- Import `GoogleEmailWriteProvider`, `ImapEmailWriteProvider`, `EmailWriteProvider`
- Instantiate both providers with existing dependencies
- Route `draftReply()`/`sendReply()` by `connector_account_id` provider type:
  - Google → `GoogleEmailWriteProvider`
  - IMAP → `ImapEmailWriteProvider`
  - Other → return "unsupported" (preserve safety floor)
- Keep all existing safety checks: RLS, scope gates, feature grants
- Behavior for Google accounts must be unchanged

### 6. Add threadId derivation for IMAP messages

**File:** `packages/email/src/reply-mime.ts` (or new file if needed)

- Current `deriveReplyTarget()` assumes Gmail `threadId` in `external_metadata`
- For IMAP: derive threadId from `Message-ID` + `References` headers in cached `external_metadata`
- IMAP threadId = first `Message-ID` in thread, or computed from normalized references
- Update `deriveReplyTarget()` to handle both Google and IMAP threadId patterns

### 7. Unit tests for providers

**Files:**

- `packages/connectors/test/google-email-write-provider.test.ts`
- `packages/connectors/test/imap-email-write-provider.test.ts`
- Test happy path: draft/send succeed with valid creds
- Test error cases: auth failed, upstream failure, no threadId
- Test sanitizer: creds never leak into `EmailWriteResult`
- Mock SMTP/IMAP clients to avoid real network calls

### 8. Integration tests (GreenMail protocol harness)

**File:** `packages/connectors/test/integration/imap-send-greenmail.test.ts`

- Reuse existing GreenMail setup from Slice C
- Test IMAP draft APPEND lands in `\Drafts`
- Test SMTP submit + IMAP APPEND lands in `\Sent`
- Test error mapping: bad creds, unreachable host
- Verify RLS: owner can send, non-owner denied
- Run in CI with Docker GreenMail

### 9. Security sanitizer tests

**File:** `packages/connectors/test/imap-sanitizer.test.ts` (extend existing)

- Assert SMTP/IMAP creds never appear in HTTP responses
- Assert SMTP/IMAP error transcripts never logged verbatim
- Assert creds never in pg-boss payloads (send is synchronous, no job created)
- Assert creds never in AI prompts (body rides stream, not DB)

### 10. Update package exports and dependencies

**Files:**

- `packages/email/src/index.ts` — export `EmailWriteProvider`
- `packages/connectors/src/index.ts` — export write providers
- `packages/chat/package.json` — ensure `@jarv1s/email` and `@jarv1s/connectors` deps current

### 11. Documentation and type checks

**File:** `CLAUDE.md` — no changes needed (invariants already documented)
**Type checks:** Run `pnpm typecheck` and fix any issues
**Lint:** Run `pnpm lint` and fix any issues

### 12. Final verification gate

**Commands:**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
pnpm test      # unit tests
pnpm test:integration  # GreenMail tests
```

- All tests must pass
- Manual smoke: connect real Yahoo account, send reply, verify delivery
- Security review: confirm creds never escape, provider-agnostic AI preserved

## Security considerations

- **Secrets never escape:** SMTP/IMAP credentials stay in-memory, never in logs/payloads/responses
- **Provider-agnostic AI:** Tools unchanged; model still only sees `cacheMessageId` + `body`
- **Metadata-only:** Send is synchronous; no pg-boss job created (body rides stream per #214)
- **RLS preserved:** All reads use `DataContextDb` with actor scoping
- **Error sanitization:** SMTP/IMAP library errors (which may embed transcripts) mapped to fixed human-safe strings

## Dependencies

- **External:** SMTP client library (to be added in task 4)
- **Internal:** All IMAP credential infrastructure from Slice C, Google OAuth from existing code
- **Blocking:** None — Slice C (#642) already merged, IMAP presets exist

## Forks to escalate

1. **SMTP library choice:** If multiple candidates exist, escalate choice to coordinator
2. **ThreadId derivation for IMAP:** If `external_metadata` structure insufficient, escalate data-shape fork
3. **Test connection reuse:** Should IMAP send reuse existing `imap-probe-client` or separate SMTP client? Escalate if unclear

## Ready to build

Plan approved by: \***\*\*\*\*\***\_\***\*\*\*\*\***  
Date: \***\*\*\*\*\***\_\***\*\*\*\*\***
