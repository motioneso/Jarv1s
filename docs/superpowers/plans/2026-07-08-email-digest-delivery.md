# Email Digest Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build scheduled notification email digests, sent through the user's connected Google/IMAP email account and controlled from Notifications settings.

**Architecture:** Store digest settings and watermark in one existing per-user `PreferencesRepository` row, keyed `notifications:digest`. Keep digest logic in `packages/notifications`; keep connector-specific fresh-send mechanics in existing email write providers. Settings routes only read/write preferences and reconcile pg-boss schedules; workers enter actor-scoped `DataContextDb` before querying notifications.

**Tech Stack:** TypeScript, Fastify, Kysely `DataContextDb`, pg-boss, Vitest, React Query.

---

## Verified Branch State

- `packages/settings/src/notification-preferences-routes.ts` only exposes module notification preferences.
- `apps/web/src/settings/settings-module-subviews.tsx` still renders `Email digest` as `coming`.
- `packages/email/src/email-write-provider.ts` has only reply `saveDraft`/`send`.
- `GoogleEmailWriteProvider.run()` returns failure when `threadId` is missing.
- `ImapEmailWriteProvider.send()` ignores thread id but still requires a cached `EmailMessage`.
- `packages/briefings/src/schedule.ts` exports reusable `cronExprFor` and `timezoneFor`.
- No existing digest routes, worker, sender, or plan exists.
- No migration needed: digest preference and `lastDigestSentAt` fit one preferences JSON row.

## File Structure

- Modify `packages/email/src/email-write-provider.ts`: add `sendNew`.
- Modify `packages/connectors/src/google-email-write-provider.ts`: send fresh Gmail message without `threadId`.
- Modify `packages/connectors/src/imap-email-write-provider.ts`: send fresh SMTP message without cached `EmailMessage`.
- Modify `packages/email/src/reply-mime.ts`: add a minimal `buildNewMessageMime` helper, or generalize the existing MIME builder if smaller.
- Create `packages/notifications/src/digest.ts`: preference parsing, scheduling, eligibility, rendering, worker handler, sender interface.
- Modify `packages/notifications/src/repository.ts`: add one digest eligibility query that excludes read/deferred rows and applies watermark.
- Modify `packages/notifications/src/index.ts`: export digest APIs.
- Modify `packages/settings/src/notification-preferences-routes.ts`: add digest GET/PUT routes beside module preferences.
- Modify `packages/shared/src/settings-api.ts`: add digest DTOs and schemas.
- Modify `apps/web/src/api/client.ts` and `apps/web/src/api/query-keys.ts`: add digest client calls/query key.
- Modify `apps/web/src/settings/settings-module-subviews.tsx`: replace `coming` row with real controls and unavailable state.
- Modify `packages/module-registry/src/index.ts`: register digest queue/worker and inject connector-backed sender.
- Tests:
  - `tests/unit/email-write-provider-send-new.test.ts`
  - `tests/unit/notification-digest.test.ts`
  - `tests/unit/notification-digest-ui.test.tsx`
  - `tests/integration/notification-digest.test.ts`

## Task 1: Fresh Email Send Provider

**Files:**

- Modify: `packages/email/src/email-write-provider.ts`
- Modify: `packages/email/src/reply-mime.ts`
- Modify: `packages/connectors/src/google-email-write-provider.ts`
- Modify: `packages/connectors/src/imap-email-write-provider.ts`
- Test: `tests/unit/email-write-provider-send-new.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import type { DataContextDb } from "@jarv1s/db";
import { buildNewMessageMime } from "@jarv1s/email";
import { GoogleEmailWriteProvider } from "@jarv1s/connectors";

describe("EmailWriteProvider.sendNew", () => {
  it("sends a fresh Gmail message without a threadId", async () => {
    const sent: unknown[] = [];
    const provider = new GoogleEmailWriteProvider(
      { getFreshAccessToken: async () => "access-token" },
      {
        createDraft: async () => undefined,
        sendMessage: async (input) => {
          sent.push(input);
        }
      }
    );

    const result = await provider.sendNew({} as DataContextDb, {
      to: "me@example.test",
      subject: "Jarvis digest",
      body: "Digest body"
    });

    expect(result).toEqual({ ok: true, mode: "send" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ accessToken: "access-token" });
    expect(sent[0]).not.toHaveProperty("threadId");
  });

  it("keeps fresh-send MIME independent from reply threading", async () => {
    const raw = buildNewMessageMime({
      to: "me@example.test",
      subject: "Jarvis digest",
      body: "Digest body"
    });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");

    expect(decoded).toContain("To: me@example.test");
    expect(decoded).toContain("Subject: Jarvis digest");
    expect(decoded).not.toContain("In-Reply-To");
    expect(decoded).not.toContain("References");
  });
});
```

- [ ] **Step 2: Verify red**

Run: `pnpm vitest run tests/unit/email-write-provider-send-new.test.ts`

Expected: FAIL because `sendNew` does not exist.

- [ ] **Step 3: Implement minimal fresh-send seam**

Add:

```ts
export interface NewEmailInput {
  readonly connectorAccountId?: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}
```

Then add `sendNew(scopedDb: DataContextDb, input: NewEmailInput): Promise<EmailWriteResult>` to `EmailWriteProvider`.

Implementation rules:

- Gmail: build MIME, call `sendMessage({ accessToken, raw })`, never pass `threadId`.
- IMAP: require `input.connectorAccountId`, load `getActiveImapAccountSecret`, send SMTP, append Sent. Cover network behavior by extending existing `tests/integration/imap-email-write-provider.integration.test.ts` if unit seams get awkward.
- Keep result messages secret-free; never log upstream errors.

- [ ] **Step 4: Verify green**

Run: `pnpm vitest run tests/unit/email-write-provider-send-new.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/email/src/email-write-provider.ts packages/email/src/reply-mime.ts packages/connectors/src/google-email-write-provider.ts packages/connectors/src/imap-email-write-provider.ts tests/unit/email-write-provider-send-new.test.ts
git commit -m "feat: support fresh connector email sends"
```

## Task 2: Digest Preference, Schedule, Render, and Worker Logic

**Files:**

- Create: `packages/notifications/src/digest.ts`
- Modify: `packages/notifications/src/repository.ts`
- Modify: `packages/notifications/src/index.ts`
- Test: `tests/unit/notification-digest.test.ts`

- [ ] **Step 1: Write failing tests**

Cover these behaviors in `tests/unit/notification-digest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DIGEST_COMPOSE_QUEUE,
  digestPreferenceFromRaw,
  digestScheduleData,
  renderNotificationDigest,
  reconcileDigestSchedule
} from "@jarv1s/notifications";

describe("notification digest preferences", () => {
  it("defaults disabled with daily 07:00 UTC metadata", () => {
    expect(digestPreferenceFromRaw(null)).toEqual({
      enabled: false,
      cadence: "daily",
      scheduleMetadata: { targetTime: "07:00", timezone: "UTC" },
      lastDigestSentAt: null
    });
  });
});

describe("notification digest scheduling", () => {
  it("uses briefing cron/timezone helpers and metadata-only payload", async () => {
    const calls: unknown[] = [];
    await reconcileDigestSchedule(
      {
        schedule: async (...args: unknown[]) => calls.push(args),
        unschedule: async () => undefined
      } as never,
      "user-1",
      {
        enabled: true,
        cadence: "weekly",
        scheduleMetadata: { targetTime: "09:30", timezone: "America/New_York", dayOfWeek: 2 },
        lastDigestSentAt: null
      }
    );

    expect(calls[0]).toEqual([
      DIGEST_COMPOSE_QUEUE,
      "30 9 * * 2",
      digestScheduleData("user-1"),
      { tz: "America/New_York", key: "digest:user-1" }
    ]);
  });
});

describe("notification digest render", () => {
  it("renders only serialized notification fields and includes settings link", () => {
    const output = renderNotificationDigest({
      baseUrl: "https://jarvis.example.test",
      notifications: [
        {
          id: "n1",
          moduleId: "briefings",
          actorUserId: "u1",
          recipientUserId: "u1",
          title: "Briefing ready",
          body: "Open Jarvis",
          metadata: { safe: "yes" },
          readAt: null,
          createdAt: "2026-07-08T12:00:00.000Z"
        }
      ]
    });

    expect(output.subject).toBe("Jarvis notification digest");
    expect(output.text).toContain("Briefing ready");
    expect(output.text).toContain("https://jarvis.example.test/settings?section=notifications");
    expect(output.text).not.toContain("token");
    expect(output.html).not.toContain("token");
  });
});
```

- [ ] **Step 2: Verify red**

Run: `pnpm vitest run tests/unit/notification-digest.test.ts`

Expected: FAIL because digest exports do not exist.

- [ ] **Step 3: Implement minimal digest module**

In `packages/notifications/src/digest.ts`:

- Export `DIGEST_COMPOSE_QUEUE = "notifications.digest.compose"`.
- Export `NOTIFICATION_DIGEST_PREFERENCE_KEY = "notifications:digest"`.
- Parse `enabled`, `cadence`, `scheduleMetadata`, `lastDigestSentAt` defensively.
- Reuse `cronExprFor` and `timezoneFor` from `@jarv1s/briefings`.
- Schedule payload must be exactly:

```ts
{
  actorUserId,
  reason: "scheduled-digest" as const,
  idempotencyKey: `digest:${actorUserId}`
}
```

- Call `assertMetadataOnlyPayload` before `boss.schedule`.
- Render from `NotificationDto[]`, not source rows.

In `NotificationsRepository`, add:

```ts
async listDigestEligible(
  scopedDb: DataContextDb,
  input: { since: Date | null; limit?: number }
): Promise<NotificationWithReadState[]>
```

Query rules:

- Same visible rows query.
- `reads.notification_id is null`.
- If `since`, `notifications.created_at > since`.
- Order oldest-first for rendering.
- Limit to a small bounded value, default `50`.

- [ ] **Step 4: Verify green**

Run: `pnpm vitest run tests/unit/notification-digest.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/notifications/src/digest.ts packages/notifications/src/repository.ts packages/notifications/src/index.ts tests/unit/notification-digest.test.ts
git commit -m "feat: add notification digest core"
```

## Task 3: Digest Settings API

**Files:**

- Modify: `packages/shared/src/settings-api.ts`
- Modify: `packages/settings/src/notification-preferences-routes.ts`
- Test: `tests/integration/notification-digest.test.ts`

- [ ] **Step 1: Write failing integration tests**

Add tests that:

- `GET /api/me/notification-digest-preference` returns disabled defaults and `available: false` when no active Google/IMAP account exists.
- Seeding an active Google or IMAP connector makes `available: true`.
- `PUT /api/me/notification-digest-preference` rejects `enabled: true` when all modules are disabled.
- A valid `PUT` persists `enabled`, `cadence`, `scheduleMetadata`, then calls injected `reconcileDigestSchedule`.

- [ ] **Step 2: Verify red**

Run: `pnpm vitest run tests/integration/notification-digest.test.ts`

Expected: FAIL with 404 route missing.

- [ ] **Step 3: Implement route and schemas**

Add DTOs:

```ts
export interface NotificationDigestPreferenceDto {
  readonly enabled: boolean;
  readonly cadence: "daily" | "weekly";
  readonly scheduleMetadata: {
    readonly targetTime: string;
    readonly timezone: string;
    readonly dayOfWeek?: number;
  };
  readonly available: boolean;
  readonly unavailableReason: "no_email_connector" | "no_enabled_modules" | null;
}
```

Routes:

- `GET /api/me/notification-digest-preference`
- `PUT /api/me/notification-digest-preference`

Keep connector availability query local to settings route via `app.connector_accounts` joined to `app.connector_definitions`, under `DataContextDb`:

```sql
status = 'active' AND provider_type IN ('google', 'imap')
```

When `enabled` is true:

- Require at least one active module notification preference.
- Require active email connector.
- Persist one preferences row.
- Reconcile schedule if `boss` dependency exists; otherwise persist only.

- [ ] **Step 4: Verify green**

Run: `pnpm vitest run tests/integration/notification-digest.test.ts`

Expected: PASS for settings route cases.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/settings-api.ts packages/settings/src/notification-preferences-routes.ts tests/integration/notification-digest.test.ts
git commit -m "feat: add notification digest settings api"
```

## Task 4: Digest Compose Worker and Sender

**Files:**

- Modify: `packages/notifications/src/digest.ts`
- Modify: `packages/module-registry/src/index.ts`
- Test: `tests/integration/notification-digest.test.ts`

- [ ] **Step 1: Add failing worker tests**

Extend `tests/integration/notification-digest.test.ts` to prove:

- Empty digest skips send.
- Disabled module notification never appears.
- Already-read notification never appears.
- Successful send advances `lastDigestSentAt`.
- Failed send does not advance watermark; next successful run includes missed notifications.
- Payload shape is metadata-only and contains no notification title/body/metadata.
- Quiet hours config does not affect digest run.
- Render output cannot contain raw source-record body markers even when notification metadata contains suspicious keys.

- [ ] **Step 2: Verify red**

Run: `pnpm vitest run tests/integration/notification-digest.test.ts`

Expected: FAIL because worker handler is missing.

- [ ] **Step 3: Implement worker handler**

In `packages/notifications/src/digest.ts`, export:

```ts
export interface NotificationDigestSender {
  sendDigest(
    scopedDb: DataContextDb,
    input: { to: string; subject: string; text: string; html: string }
  ): Promise<{ ok: boolean }>;
}
```

Handler flow:

1. Parse preference; return skipped if disabled.
2. Fetch eligible unread rows via `listDigestEligible`.
3. Filter rows whose module preference is enabled by injected `NotificationPreferencePort`.
4. Return skipped if empty.
5. Map rows through `serializeNotification`.
6. Render digest.
7. Fetch actor email from `app.users` under `DataContextDb`.
8. Send through injected sender.
9. Only on `ok: true`, upsert preference with `lastDigestSentAt = now`.

In `packages/module-registry/src/index.ts`:

- Add `NOTIFICATION_DIGEST_QUEUE_DEFINITIONS`.
- Add notifications worker registration using `registerDataContextWorker`.
- Build sender with existing `GoogleEmailWriteProvider`/`ImapEmailWriteProvider`; select the active connector account by provider type, prefer Google if present.

- [ ] **Step 4: Verify green**

Run: `pnpm vitest run tests/integration/notification-digest.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/notifications/src/digest.ts packages/module-registry/src/index.ts tests/integration/notification-digest.test.ts
git commit -m "feat: deliver notification email digests"
```

## Task 5: Notifications Settings UI

**Files:**

- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/query-keys.ts`
- Modify: `apps/web/src/settings/settings-module-subviews.tsx`
- Test: `tests/unit/notification-digest-ui.test.tsx`

- [ ] **Step 1: Write failing UI/model test**

Test that the settings view:

- Shows digest as unavailable when API returns `available: false`.
- Enables/disables digest through API mutation when available.
- Shows cadence and time controls.

- [ ] **Step 2: Verify red**

Run: `pnpm vitest run tests/unit/notification-digest-ui.test.tsx`

Expected: FAIL because digest client/UI does not exist.

- [ ] **Step 3: Implement minimal UI**

Replace the `Email digest` `coming` row with:

- Disabled `Switch` when `available === false`.
- `Segmented` for `daily`/`weekly` when enabled.
- Native `<input type="time">`.
- Native `<select>` or numeric control for weekly `dayOfWeek`.
- Use browser timezone default only when no server value exists.

Do not add a date/time picker dependency.

- [ ] **Step 4: Verify green**

Run: `pnpm vitest run tests/unit/notification-digest-ui.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/api/query-keys.ts apps/web/src/settings/settings-module-subviews.tsx tests/unit/notification-digest-ui.test.tsx
git commit -m "feat: enable notification digest settings"
```

## Task 6: Final Gates

**Files:**

- All touched files.

- [ ] **Step 1: Run focused tests**

```bash
pnpm vitest run tests/unit/email-write-provider-send-new.test.ts tests/unit/notification-digest.test.ts tests/unit/notification-digest-ui.test.tsx tests/integration/notification-digest.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run required pre-push checks**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
```

Expected: all exit 0.

- [ ] **Step 3: Sync graph**

```bash
codegraph sync .
```

Expected: exits 0.

- [ ] **Step 4: Rebase before push**

```bash
git fetch origin main
git rebase origin/main
```

Expected: exits 0 or resolves cleanly.

## Self-Review

- Spec coverage: preference, cadence, schedule metadata, module gating, connector availability, no-thread send, empty skip, quiet-hours independence, settings link, failed-send watermark, duplicate suppression, metadata-only payload, sanitized render, and UI activation are covered.
- Placeholder scan: no placeholder language or unspecified error handling remains.
- Type consistency: `NotificationDigestPreferenceDto`, `sendNew`, `NotificationDigestSender`, and preference key names are consistent across tasks.
- Skipped migration: preferences JSON row covers cadence and watermark; add a table only if future querying/reporting needs it.
