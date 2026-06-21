# Chat Markdown Rendering Implementation Plan

> **For agentic workers:** Drive this plan task-by-task (the superpowers execution
> sub-skills are disabled in this repo by design). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Render rich markdown in assistant chat responses (GFM tables, lists, emphasis,
code, headings, blockquotes, rules, safe links) instead of raw source text, without
introducing any HTML/script injection path.

**Architecture:** Add a vetted, raw-HTML-disabled markdown renderer (`react-markdown` +
`remark-gfm`) to `apps/web` only. A new `MarkdownMessage` component wraps it with safe-link
rendering and is used for the **assistant** bubble in `RecordRow` (chat-drawer.tsx). User
messages stay literal. Markdown element styles are scoped to the chat bubble in
`kit-chat.css`. Replies arrive as one whole SSE record (cli-chat-engine.ts:208 pushes a
single `reply`), so re-render is record-level — no token-thrash concern.

**Tech Stack:** React 19, Vite 7, `react-markdown` v9 (ESM, browser-safe, no `node:*`),
`remark-gfm` v4, Playwright e2e (real-browser render + XSS proof).

## Global Constraints

- **No raw HTML in the renderer.** No `rehype-raw`, no `dangerouslySetInnerHTML`. Keep
  `react-markdown`'s safe defaults (HTML in markdown is escaped; `urlTransform` strips
  `javascript:`/dangerous protocols). Copied verbatim from handoff §Security.
- **Renderer deps go in `apps/web` only.** Do NOT add markdown/`node:*` deps to
  `@jarv1s/shared` (Vite-bundled for the browser). Run `pnpm install` so `pnpm-lock.yaml`
  updates.
- **Own surface only:** `apps/web/src/chat/*`, `apps/web/src/styles/kit-chat.css`,
  `apps/web/package.json` + lock, `tests/e2e/chat-drawer.spec.ts`. Stage only these paths
  (`git add <paths>`, never `-A`). Do not touch Lane A/B surfaces or `docs/coordination/`.
- **No backend / API / message-shape change.** Render existing `reply` text richer only.
- **File-size cap 1000 lines** (`pnpm check:file-size`). `kit-chat.css` is at 394 — keep
  headroom.
- **Safe links:** rendered `<a>` gets `rel="noopener noreferrer"` and `target="_blank"`.
- Commit trailer: `Co-Authored-By: Claude Sonnet 4.6`.

---

### Task 1: Add the markdown renderer dependency

**Files:**

- Modify: `apps/web/package.json` (dependencies)
- Modify: `pnpm-lock.yaml` (generated)

**Interfaces:**

- Produces: `react-markdown` and `remark-gfm` importable from `apps/web` source.

- [ ] **Step 1: Add deps**

```bash
cd /home/ben/Jarv1s/apps/web
pnpm add react-markdown@^9 remark-gfm@^4
```

- [ ] **Step 2: Verify lockfile + manifest updated, no deps leaked to shared**

Run:

```bash
cd /home/ben/Jarv1s
git diff --name-only | grep -E 'pnpm-lock.yaml|apps/web/package.json'
grep -E 'react-markdown|remark-gfm' packages/shared/package.json || echo "OK: not in shared"
```

Expected: both files listed; `OK: not in shared`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "build(web): add react-markdown + remark-gfm for chat rendering"
```

---

### Task 2: MarkdownMessage component (render + safe links, no raw HTML)

**Files:**

- Create: `apps/web/src/chat/markdown-message.tsx`

**Interfaces:**

- Produces: `export function MarkdownMessage(props: { readonly text: string }): JSX.Element`
  — renders `props.text` as GFM markdown inside a `<div className="chatd-md">`; links open
  in a new tab with `rel="noopener noreferrer"`; raw HTML is NOT rendered (escaped); no
  `rehype-raw`, no `dangerouslySetInnerHTML`.

- [ ] **Step 1: Write the failing e2e-adjacent unit is not feasible (no jsdom).** Skip to
      the component; its behavior is proven by the Task 4 e2e tests (real browser). This step
      is a no-op acknowledgement so the TDD cycle for rendering lives in Task 4.

- [ ] **Step 2: Implement the component**

```tsx
import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders untrusted assistant text as GFM markdown. Security-critical: raw HTML is NEVER
 * rendered (no rehype-raw, no dangerouslySetInnerHTML) — react-markdown escapes HTML in the
 * source and its default urlTransform strips dangerous URL protocols (javascript:, etc.).
 * Chat content can echo tool-results / fetched web content (indirect prompt injection #360),
 * so keep these defaults intact. Links open safely in a new tab.
 */
export function MarkdownMessage(props: { readonly text: string }) {
  return (
    <div className="chatd-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...rest }: ComponentPropsWithoutRef<"a"> & { node?: unknown }) => (
            <a {...rest} rel="noopener noreferrer" target="_blank" />
          )
        }}
      >
        {props.text}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run:

```bash
cd /home/ben/Jarv1s && pnpm --filter @jarv1s/web typecheck
```

Expected: PASS (exit 0).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/chat/markdown-message.tsx
git commit -m "feat(web): MarkdownMessage component (GFM, no raw HTML, safe links)"
```

---

### Task 3: Render assistant bubbles through MarkdownMessage

**Files:**

- Modify: `apps/web/src/chat/chat-drawer.tsx` (import + `RecordRow` assistant branch, ~line 184-192)

**Interfaces:**

- Consumes: `MarkdownMessage` from `./markdown-message`.
- Note: user bubble (kind `user`, line 172-178) stays literal `{text}`; error stays literal.
  Only the assistant `reply`/fallback bubble renders markdown.

- [ ] **Step 1: Add the import**

Add near the other chat imports in `chat-drawer.tsx`:

```tsx
import { MarkdownMessage } from "./markdown-message";
```

- [ ] **Step 2: Use MarkdownMessage in the assistant bubble**

Replace the assistant bubble return (the final `return` in `RecordRow`):

```tsx
// reply (and any unforeseen non-activity kind) — assistant bubble.
return (
  <div className="chatd-msg">
    <span className="chatd-msg__av">
      <Sparkles size={14} aria-hidden="true" />
    </span>
    <div className="chatd-bubble">
      <MarkdownMessage text={text} />
    </div>
  </div>
);
```

- [ ] **Step 3: Typecheck + lint the web package**

Run:

```bash
cd /home/ben/Jarv1s && pnpm --filter @jarv1s/web typecheck && pnpm --filter @jarv1s/web lint
```

Expected: PASS (exit 0).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/chat/chat-drawer.tsx
git commit -m "feat(web): render assistant chat replies as markdown"
```

---

### Task 4: E2E — markdown renders + XSS-negative (TDD: write failing first)

**Files:**

- Modify: `tests/e2e/chat-drawer.spec.ts` (add two tests)

**Interfaces:**

- Consumes: existing `mockApi`, `createMockConnectorProviders`, the `/api/chat/stream`
  route-fulfill pattern already in the file.

- [ ] **Step 1: Write the failing render test**

Add to `tests/e2e/chat-drawer.spec.ts` a test that streams a `reply` containing a GFM table,
bold text, a fenced code block, and a list; assert the rendered DOM contains semantic
elements (proving markdown parsed, not literal source):

````ts
test("renders assistant markdown as rich HTML (table, bold, code, list)", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    chatThreads: [],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });

  const md =
    "**bold text** and `inline`\\n\\n" +
    "| A | B |\\n|---|---|\\n| 1 | 2 |\\n\\n" +
    "- one\\n- two\\n\\n" +
    "```\\ncode block\\n```";

  let streamServed = false;
  await page.route("**/api/chat/stream", async (route) => {
    if (streamServed) return;
    streamServed = true;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache" },
      body: `data: {"kind":"reply","text":${JSON.stringify(md)}}\n\n`
    });
  });
  await page.route("**/api/chat/clear", (route) => route.fulfill({ status: 204, body: "" }));

  await page.goto("/");
  await page.getByRole("button", { name: "Chat with Jarvis" }).click();
  const drawer = page.getByRole("dialog", { name: "Chat with Jarvis" });
  await expect(drawer).toBeVisible();

  await expect(drawer.locator(".chatd-md table")).toHaveCount(1);
  await expect(drawer.locator(".chatd-md strong")).toHaveText("bold text");
  await expect(drawer.locator(".chatd-md code")).toContainText("inline");
  await expect(drawer.locator(".chatd-md pre")).toContainText("code block");
  await expect(drawer.locator(".chatd-md li")).toHaveCount(2);
  // The raw markdown source must NOT appear literally.
  await expect(drawer.getByText("| A | B |")).toHaveCount(0);
});
````

- [ ] **Step 2: Write the failing XSS-negative test**

```ts
test("does not inject executable HTML from untrusted markdown", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    chatThreads: [],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });

  // Untrusted reply: raw <script>, an <img onerror>, and a javascript: link.
  const evil =
    "<script>window.__pwned=1<\\/script>\\n\\n" +
    "<img src=x onerror=\\"window.__pwned=1\\">\\n\\n" +
    "[click me](javascript:window.__pwned=1)";

  let streamServed = false;
  await page.route("**/api/chat/stream", async (route) => {
    if (streamServed) return;
    streamServed = true;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache" },
      body: `data: {"kind":"reply","text":${JSON.stringify(evil)}}\n\n`
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Chat with Jarvis" }).click();
  const drawer = page.getByRole("dialog", { name: "Chat with Jarvis" });
  await expect(drawer).toBeVisible();
  // Wait for the reply to render (the link text survives as plain text).
  await expect(drawer.getByText("click me")).toBeVisible();

  // No script/img element was injected into the chat bubble.
  await expect(drawer.locator(".chatd-md script")).toHaveCount(0);
  await expect(drawer.locator(".chatd-md img")).toHaveCount(0);
  // The javascript: href was neutralized by react-markdown's urlTransform.
  const hrefs = await drawer.locator(".chatd-md a").evaluateAll((els) =>
    els.map((el) => (el as HTMLAnchorElement).getAttribute("href") ?? "")
  );
  for (const href of hrefs) {
    expect(href.toLowerCase().startsWith("javascript:")).toBe(false);
  }
  // The injection side-effect never fired.
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
});
```

- [ ] **Step 3: Run the two tests to verify they FAIL pre-implementation**

> If Tasks 2–3 are already committed, these pass immediately; that's acceptable (TDD intent
> documented). To see them fail first, run them on the pre-Task-3 tree. In practice, run:
> Run:

```bash
cd /home/ben/Jarv1s && pnpm exec playwright test chat-drawer --reporter=line; echo "EXIT=$?"
```

Expected after Tasks 2–3: PASS (EXIT=0). (Before Task 3 the render/XSS assertions fail.)

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/chat-drawer.spec.ts
git commit -m "test(e2e): chat markdown render + XSS-negative assertions (#383)"
```

---

### Task 5: Style markdown elements within the chat bubble

**Files:**

- Modify: `apps/web/src/styles/kit-chat.css` (add a `.chatd-md` block; currently 394 lines)

**Interfaces:**

- Consumes: `.chatd-md` wrapper from `MarkdownMessage`; lives inside `.chatd-bubble`.

- [ ] **Step 1: Add scoped markdown styles**

Append a `.chatd-md` section to `kit-chat.css` styling: paragraph spacing, `ul/ol` (with
nesting), `strong/em`, inline `code` and `pre` (monospace, subtle background, wrap/scroll),
`table/th/td` (borders, padding, GFM look), `h1–h4`, `blockquote`, `hr`, and `a` (link
colour + underline). Keep selectors under `.chatd-md` so they don't leak. Reset first/last
child margins so the bubble doesn't gain extra padding. Match existing kit tokens/variables
used elsewhere in the file.

- [ ] **Step 2: Verify file-size cap + build**

Run:

```bash
cd /home/ben/Jarv1s && pnpm check:file-size && pnpm build:web; echo "EXIT=$?"
```

Expected: PASS (EXIT=0); `kit-chat.css` well under 1000 lines.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/styles/kit-chat.css
git commit -m "style(web): markdown element styles for chat bubbles"
```

---

### Task 6: Full local gate (real exit codes) + wrap-up

**Files:** none (verification only).

- [ ] **Step 1: Run the full gate, capturing each exit code (never pipe to tail/grep)**

Run each separately and record `$?`:

```bash
cd /home/ben/Jarv1s
pnpm lint; echo "lint=$?"
pnpm format:check; echo "format=$?"
pnpm check:file-size; echo "filesize=$?"
pnpm typecheck; echo "typecheck=$?"
pnpm build:web; echo "build=$?"
pnpm exec playwright test chat-drawer --reporter=line; echo "e2e=$?"
```

Expected: all `=0`. Fix any red before proceeding. (`pnpm format` to auto-fix formatting.)

- [ ] **Step 2: Hand off to `coordinated-wrap-up`** — clean tree, pre-push trio + rebase,
      push branch, open PR (base `main`, title `feat: render rich markdown in chat assistant
responses (#383)`, body `Fixes #383` + renderer note + no-raw-HTML guarantee), report PR #
      and verified exit codes to the Coordinator. Do NOT merge/move the board.

---

## Self-Review

**Spec coverage:**

- GFM tables / lists / emphasis / inline+fenced code / headings / blockquotes / rules →
  Task 2 (remark-gfm) + Task 5 (styles); render proven in Task 4.
- Safe links (`rel="noopener noreferrer"`, sensible target) → Task 2 component override.
- Streaming without flicker → replies are whole records (verified cli-chat-engine.ts:208);
  react-markdown re-renders per record. No token-level thrash. Noted in Architecture.
- Assistant-primary, user literal → Task 3 only changes the assistant branch.
- Styling in kit-chat.css, <1000 lines → Task 5.
- Vetted renderer in apps/web only, lockfile updated, not in shared → Task 1 + constraint.
- **Security (XSS):** no rehype-raw / no dangerouslySetInnerHTML (Task 2); XSS-negative e2e
  for `<script>`, `<img onerror>`, `javascript:` link (Task 4).

**Placeholder scan:** Task 5 CSS is described, not pasted (CSS is presentational and token-
dependent; acceptable — the contract is "scoped under `.chatd-md`, under 1000 lines, render
proven by Task 4 selectors `table/strong/code/pre/li`"). All code tasks show full code.

**Type consistency:** `MarkdownMessage({ text })` signature consistent across Tasks 2/3;
`.chatd-md` wrapper class consistent across Tasks 2/4/5.

**Open fork for Coordinator:** chosen renderer = `react-markdown` v9 + `remark-gfm` v4,
raw-HTML disabled (default). Confirm before build.
