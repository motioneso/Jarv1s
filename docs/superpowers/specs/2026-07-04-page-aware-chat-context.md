# Page-Aware Chat Context (#679)

**Status:** approved
**Issue:** #679
**Author:** Codex, grill-me with Ben - 2026-07-04

## 1. Problem

When the user asks Jarv1s about something visible in the app, Jarv1s should understand the current
page context. The core use case is natural questions like "why does this say X on the page here?"

## 2. Decisions

- V1 is Jarv1s web app only, not external websites.
- Page context is supplied only when the user asks from chat. Do not continuously stream page
  content into chat.
- Use a hybrid model:
  - baseline sanitized page snapshot for all pages.
  - focused/selected element context when naturally available.
  - optional richer module context over time for high-value pages.
- Snapshot matching should use the user's quoted/mentioned text plus nearby visible context.
- Focus/selection improves "this"/"here" handling but is not required for V1.
- Explicit element selection/annotation mode is separate follow-up #745.
- Follow field privacy. Do not include raw secrets, tokens, password values, or sensitive field
  values.
- Page snapshots are short-lived chat session context, not permanent transcript metadata.
- Jarv1s may learn useful user-relevant facts from page-aware conversations, but does not store raw
  page snapshots. Private/incognito chat still disables memory writes.

## 3. Scope

- Add a client-side page context capture layer that can produce sanitized snapshots on demand.
- Include visible text, headings, labels, roles, buttons, current route/page title, focused element,
  selected text/element where available, and nearby context.
- Exclude hidden DOM, raw HTML, arbitrary attributes, secret values, sensitive field values, and
  private tokens.
- Send the snapshot with the chat turn only when the user's message asks about the current page.
- Keep the latest inspected snapshot in volatile session state long enough for follow-up questions.
- Allow memory extraction to use derived facts from the interaction/page context, but not raw
  snapshots.

## 4. Non-Goals

- External website/browser inspection.
- Screenshot-based interpretation.
- Raw DOM upload.
- Persistent storage of page snapshots.
- Explicit point-and-click element selection (#745).

## 5. Acceptance

- User can ask about visible text on the current Jarv1s page and Jarv1s receives enough sanitized
  context to answer.
- Follow-up questions can use the latest inspected page context within the chat session.
- Sensitive fields are redacted according to field privacy.
- Raw snapshots are not stored in durable transcript metadata, memory, logs, or job payloads.
- Private/incognito chat prevents memory writes from page-aware conversations.
- Tests cover redaction, on-demand capture, and follow-up session context.

## 6. Files In Play

- `~/Jarv1s/apps/web/src/chat/*`
- `~/Jarv1s/apps/web/src/app-route-metadata.ts`
- `~/Jarv1s/apps/web/src/app.tsx`
- `~/Jarv1s/packages/chat/src/live/*`
- `~/Jarv1s/packages/chat/src/routes.ts`
- `~/Jarv1s/packages/shared/*chat*`

