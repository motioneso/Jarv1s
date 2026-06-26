# Settings Google JSON Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings -> Connect Google accepts a Google OAuth client JSON file and fills the existing client ID / client secret fields, while onboarding keeps the same behavior through shared helpers.

**Architecture:** Extract onboarding's JSON credential parser into `apps/web/src/connectors/google-credentials.ts`, then have onboarding and settings call the same `importCredentialsJson(event)` helper. Keep upload client-side only; no API, migration, logging, persistence, or new dependency.

**Tech Stack:** React, TypeScript, Vitest, Playwright, existing `lucide-react` icons and `onb-json-upload` styles.

---

## Verified Current State

- `apps/web/src/onboarding/google-connector-step.tsx` still owns `importCredentialsJson(event)` at line 78 and `extractGoogleClientCredentials(payload)` at line 435.
- `apps/web/src/connectors/google-credentials.ts` does not exist.
- `apps/web/src/settings/settings-google-connect.tsx` has `GoogleConnect` with manual paste fields only in the `1 · Paste your client credentials` section.
- `tests/e2e/connect-google.spec.ts` already covers the settings manual paste flow.

## File Structure

- Create `apps/web/src/connectors/google-credentials.ts`: shared parser and file-input import helper.
- Modify `apps/web/src/onboarding/google-connector-step.tsx`: import helper, remove local parser/import code, preserve local status state.
- Modify `apps/web/src/settings/settings-google-connect.tsx`: import helper and `Upload`, add status state, add upload label/status above `CredField`s.
- Create `tests/unit/google-credentials.test.ts`: pure parser/import helper coverage with fake JSON files only.
- Modify `tests/e2e/connect-google.spec.ts`: prove settings upload fills fields and manual fields remain usable.

### Task 1: Shared Credential Helper

**Files:**
- Create: `apps/web/src/connectors/google-credentials.ts`
- Create: `tests/unit/google-credentials.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `tests/unit/google-credentials.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  extractGoogleClientCredentials,
  importCredentialsJson
} from "../../apps/web/src/connectors/google-credentials.js";

function fileEvent(payload: string) {
  const input = document.createElement("input");
  const file = new File([payload], "client_secret.json", { type: "application/json" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  return { target: input } as unknown as Parameters<typeof importCredentialsJson>[0];
}

describe("extractGoogleClientCredentials", () => {
  it("extracts installed-app Google OAuth credentials", () => {
    expect(
      extractGoogleClientCredentials({
        installed: {
          client_id: " cid.apps.googleusercontent.com ",
          client_secret: " GOCSPX-fake-secret "
        }
      })
    ).toEqual({
      clientId: "cid.apps.googleusercontent.com",
      clientSecret: "GOCSPX-fake-secret"
    });
  });

  it("extracts web-app Google OAuth credentials", () => {
    expect(
      extractGoogleClientCredentials({
        web: {
          client_id: "web.apps.googleusercontent.com",
          client_secret: "GOCSPX-web-secret"
        }
      })
    ).toEqual({
      clientId: "web.apps.googleusercontent.com",
      clientSecret: "GOCSPX-web-secret"
    });
  });

  it("rejects non-Google credential shapes", () => {
    expect(extractGoogleClientCredentials({ installed: { client_id: "only-id" } })).toBeNull();
  });
});

describe("importCredentialsJson", () => {
  it("returns credentials and clears the file input after valid JSON import", async () => {
    const event = fileEvent(
      JSON.stringify({
        installed: {
          client_id: "cid.apps.googleusercontent.com",
          client_secret: "GOCSPX-fake-secret"
        }
      })
    );

    await expect(importCredentialsJson(event)).resolves.toEqual({
      clientId: "cid.apps.googleusercontent.com",
      clientSecret: "GOCSPX-fake-secret"
    });
    expect(event.target.value).toBe("");
  });

  it("returns a clear shape error for valid JSON with wrong fields", async () => {
    await expect(importCredentialsJson(fileEvent(JSON.stringify({ nope: true })))).resolves.toEqual({
      error: "That file does not look like a Google OAuth client JSON file."
    });
  });

  it("returns a clear read error for invalid JSON", async () => {
    await expect(importCredentialsJson(fileEvent("{not-json"))).resolves.toEqual({
      error: "Could not read that JSON file."
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run tests/unit/google-credentials.test.ts
```

Expected: FAIL because `apps/web/src/connectors/google-credentials.ts` is missing.

- [ ] **Step 3: Add minimal shared helper**

Create `apps/web/src/connectors/google-credentials.ts`:

```ts
import type { ChangeEvent } from "react";

export type GoogleClientCredentials = {
  readonly clientId: string;
  readonly clientSecret: string;
};

export type GoogleCredentialsImportResult =
  | GoogleClientCredentials
  | { readonly error: string };

export async function importCredentialsJson(
  event: ChangeEvent<HTMLInputElement>
): Promise<GoogleCredentialsImportResult | null> {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return null;

  try {
    const payload = JSON.parse(await file.text()) as unknown;
    const credentials = extractGoogleClientCredentials(payload);
    return credentials ?? { error: "That file does not look like a Google OAuth client JSON file." };
  } catch {
    return { error: "Could not read that JSON file." };
  }
}

export function extractGoogleClientCredentials(payload: unknown): GoogleClientCredentials | null {
  if (!isRecord(payload)) return null;
  const root = isRecord(payload.installed)
    ? payload.installed
    : isRecord(payload.web)
      ? payload.web
      : payload;
  const clientId = root.client_id;
  const clientSecret = root.client_secret;
  if (typeof clientId !== "string" || typeof clientSecret !== "string") return null;
  if (!clientId.trim() || !clientSecret.trim()) return null;
  return { clientId: clientId.trim(), clientSecret: clientSecret.trim() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm vitest run tests/unit/google-credentials.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/connectors/google-credentials.ts tests/unit/google-credentials.test.ts
git commit -m "feat: extract google credential JSON helper"
```

### Task 2: Onboarding Uses Shared Helper

**Files:**
- Modify: `apps/web/src/onboarding/google-connector-step.tsx`

- [ ] **Step 1: Update imports and local handler**

In `apps/web/src/onboarding/google-connector-step.tsx`:

```ts
import { importCredentialsJson } from "../connectors/google-credentials";
```

Keep `ChangeEvent` in the React type import. Replace the local `const importCredentialsJson = async ...` function with:

```ts
  const handleCredentialsJsonImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const result = await importCredentialsJson(event);
    if (!result) return;
    if ("error" in result) {
      setJsonImportStatus(result.error);
      return;
    }
    google.setClientId(result.clientId);
    google.setClientSecret(result.clientSecret);
    setJsonImportStatus("Credentials imported from JSON.");
  };
```

Change the file input:

```tsx
<input
  type="file"
  accept="application/json,.json"
  onChange={handleCredentialsJsonImport}
/>
```

Delete the old local `extractGoogleClientCredentials` and `isRecord` functions.

- [ ] **Step 2: Run focused checks**

Run:

```bash
pnpm vitest run tests/unit/google-credentials.test.ts
pnpm typecheck
```

Expected: both PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/onboarding/google-connector-step.tsx
git commit -m "refactor: reuse google credential import in onboarding"
```

### Task 3: Settings Upload UI

**Files:**
- Modify: `apps/web/src/settings/settings-google-connect.tsx`
- Modify: `tests/e2e/connect-google.spec.ts`

- [ ] **Step 1: Add settings upload code**

In `apps/web/src/settings/settings-google-connect.tsx`, add `Upload` to the lucide import, import `useState`, and import the helper:

```ts
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Fingerprint,
  KeyRound,
  Link2,
  Monitor,
  ShieldCheck,
  Upload
} from "lucide-react";
import { useState } from "react";
import type { ChangeEvent, ReactNode } from "react";

import { importCredentialsJson } from "../connectors/google-credentials";
```

Inside `GoogleConnect`, before `const { toast } = useFeedback();`:

```ts
  const [jsonImportStatus, setJsonImportStatus] = useState<string | null>(null);
```

Before `const cidOk = ...`, add:

```ts
  const handleCredentialsJsonImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const result = await importCredentialsJson(event);
    if (!result) return;
    if ("error" in result) {
      setJsonImportStatus(result.error);
      return;
    }
    google.setClientId(result.clientId);
    google.setClientSecret(result.clientSecret);
    setJsonImportStatus("Credentials imported from JSON.");
  };
```

Inside the first `onb-cred` block, directly under `1 · Paste your client credentials`, add:

```tsx
          <label className="onb-json-upload">
            <input
              type="file"
              accept="application/json,.json"
              onChange={handleCredentialsJsonImport}
            />
            <span className="onb-json-upload__icon">
              <Upload size={15} aria-hidden="true" />
            </span>
            <span className="onb-json-upload__main">
              <span className="onb-json-upload__title">
                Or upload your Google client JSON file
              </span>
              <span className="onb-json-upload__sub">
                We will extract the client ID and client secret automatically.
              </span>
            </span>
          </label>
          {jsonImportStatus ? (
            <div className="onb-json-upload__status">{jsonImportStatus}</div>
          ) : null}
```

- [ ] **Step 2: Extend settings E2E**

In `tests/e2e/connect-google.spec.ts`, after `await expect(page.getByText("Connect Google")).toBeVisible();`, replace the manual credential fill with:

```ts
  await page
    .locator('input[type="file"]')
    .setInputFiles({
      name: "client_secret.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          installed: {
            client_id: "cid.apps.googleusercontent.com",
            client_secret: "my-client-secret"
          }
        })
      )
    });
  await expect(page.getByText("Credentials imported from JSON.")).toBeVisible();
  await expect(page.getByLabel("Google client ID")).toHaveValue("cid.apps.googleusercontent.com");
  await expect(page.getByLabel("Google client secret")).toHaveValue("my-client-secret");

  await page.getByLabel("Google client secret").fill("my-client-secret-edited");
```

Keep the existing `Open consent screen` / redirect / finish assertions unchanged.

- [ ] **Step 3: Run focused checks**

Run:

```bash
pnpm vitest run tests/unit/google-credentials.test.ts
pnpm test:e2e -- tests/e2e/connect-google.spec.ts
pnpm typecheck
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/settings/settings-google-connect.tsx tests/e2e/connect-google.spec.ts
git commit -m "feat: upload google credentials JSON in settings"
```

### Task 4: Final Local Gate

**Files:**
- No edits expected.

- [ ] **Step 1: Run required local gate**

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm vitest run tests/unit/google-credentials.test.ts tests/unit/google-connect-invalidation.test.tsx
pnpm test:e2e -- tests/e2e/connect-google.spec.ts
```

Expected: all exit 0.

- [ ] **Step 2: Re-index graph after meaningful edits**

Run:

```bash
codegraph sync .
```

Expected: exits 0, or record failure if `codegraph` is unavailable.

- [ ] **Step 3: Pre-push trio and rebase before push**

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
git fetch origin main
git rebase origin/main
```

Expected: all exit 0; resolve any rebase conflict with coordinator if one touches this spec's files.

## Self-Review

- Spec coverage: settings supports manual paste and JSON upload; shared helper preserves onboarding import; invalid JSON and wrong shapes return exact requested messages; no backend/API/migration/permission changes.
- Placeholder scan: no TBD/TODO/fill-later steps.
- Type consistency: helper returns `GoogleClientCredentials | { error } | null`; both consumers handle null, error, success.
- Security: tests use fake credential values only; status strings never echo secrets; upload only mutates local React state.
