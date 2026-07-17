/**
 * #679 — "Jarvis can see what page I'm on."
 *
 * Captures a bounded, redacted snapshot of the current page ONLY when the user's
 * message appears to be asking about it (see {@link asksAboutCurrentPage}), and only
 * for that one turn — see `sendChatTurn` in ../api/client.ts and
 * ChatSessionManager.engineText in packages/chat, which folds the snapshot into the
 * engine-bound prompt but never into the persisted message text.
 *
 * Design choices, in order of how much privacy weight they carry:
 *
 *   1. Raw input/textarea VALUES are NEVER read, at all, under any circumstance —
 *      there is no code path in this file that reads `.value` off a form control.
 *      Only structural text (headings, button labels, `<label>` text, plain visible
 *      text) is captured.
 *   2. Password fields (`type="password"`), hidden fields (`type="hidden"`), and any
 *      field whose `autocomplete` attribute matches a secret-shaped token
 *      (current-password / new-password / one-time-code / cc-*) are excluded, along
 *      with anything under a `data-jarvis-no-capture` opt-out attribute.
 *   3. Hidden DOM (native `hidden`, `aria-hidden="true"`, `display:none`,
 *      `visibility:hidden`) is excluded.
 *   4. Everything captured is size- and count-capped before it ever leaves this
 *      module (see {@link buildPageContextSnapshot}); the server re-bounds it again
 *      independently (packages/chat/src/live/page-context.ts) as defense in depth.
 *
 * The redaction DECISION logic (`isSensitiveElementSignals` / `isHiddenElementSignals`)
 * and the capping/truncation logic (`buildPageContextSnapshot`) are pure functions that
 * take plain data, not real DOM nodes — so they are exercised directly by unit tests
 * without needing a DOM implementation. Only the thin, mechanical DOM-walking adapter
 * (`capturePageContextSnapshot`, `elementPrivacySignals`, `collectPageContextCandidates`)
 * touches real browser APIs.
 */
import type {
  JarvisError,
  JarvisErrorClass,
  PageContextFocusedElementDto,
  PageContextSnapshotDto
} from "@jarv1s/shared";

import { resolvePageHeading } from "../app-route-metadata.js";

const MAX_HEADINGS = 12;
const MAX_BUTTONS = 20;
const MAX_LABELS = 20;
const MAX_VISIBLE_TEXT_ITEMS = 20;
const MAX_TEXT_LENGTH = 200;
const MAX_ROUTE_LENGTH = 200;
const MAX_TITLE_LENGTH = 200;
const MAX_SELECTED_TEXT_LENGTH = 500;
const MAX_CONTEXT_ERRORS = 10;

const ERROR_CLASSES = new Set<JarvisErrorClass>([
  "prerequisite",
  "transient",
  "validation",
  "permission",
  "bug"
]);

// ─── Pure redaction decisions (DOM-independent, unit-tested directly) ──────────────

/**
 * The subset of an element's attributes/computed style relevant to deciding whether
 * it (and its subtree) must be excluded from the captured snapshot. Extracted from a
 * real DOM Element by {@link elementPrivacySignals}; kept as a plain object so the
 * redaction DECISION below is a pure function.
 */
export interface ElementPrivacySignals {
  readonly tag: string;
  readonly type: string | null;
  readonly autocomplete: string | null;
  readonly hidden: boolean;
  readonly ariaHidden: boolean;
  readonly display: string | null;
  readonly visibility: string | null;
  readonly noCapture: boolean;
}

const SENSITIVE_INPUT_TYPES = new Set(["password", "hidden"]);
// Matches the native autocomplete tokens that signal a secret-shaped field:
// current-password, new-password, one-time-code, and any cc-* (payment card) token.
const SENSITIVE_AUTOCOMPLETE_PATTERN = /(current|new)-password|one-time-code|^cc-/i;

/**
 * True when an element (by its extracted signals) — and its entire subtree — must be
 * excluded from capture. This module never reads field VALUES regardless of this
 * check; the check exists so a password/secret field's surrounding structural text
 * (e.g. its own placeholder) is not captured either.
 */
export function isSensitiveElementSignals(signals: ElementPrivacySignals): boolean {
  if (signals.noCapture) return true;
  if (signals.tag === "input" && signals.type !== null && SENSITIVE_INPUT_TYPES.has(signals.type)) {
    return true;
  }
  if (signals.autocomplete !== null && SENSITIVE_AUTOCOMPLETE_PATTERN.test(signals.autocomplete)) {
    return true;
  }
  return false;
}

/** True when an element is not visible and so must be excluded from capture. */
export function isHiddenElementSignals(signals: ElementPrivacySignals): boolean {
  if (signals.hidden || signals.ariaHidden) return true;
  if (signals.display === "none" || signals.visibility === "hidden") return true;
  return false;
}

// ─── Pure capping/truncation builder (DOM-independent, unit-tested directly) ───────

export type PageContextCandidateKind = "heading" | "button" | "label" | "text";

export interface PageContextCandidate {
  readonly kind: PageContextCandidateKind;
  readonly text: string;
}

export interface PageContextFocusInfo {
  readonly tag: string;
  readonly role: string | null;
  readonly label: string | null;
}

export interface PageContextRawInput {
  readonly route: string;
  readonly pageTitle: string;
  readonly candidates: readonly PageContextCandidate[];
  readonly focused: PageContextFocusInfo | null;
  readonly selectedText: string | null;
  readonly errors?: readonly JarvisError[];
}

/**
 * Assemble the already-redacted candidate list into the bounded, capped
 * {@link PageContextSnapshotDto} the server accepts. Pure: no DOM, no globals.
 */
export function buildPageContextSnapshot(input: PageContextRawInput): PageContextSnapshotDto {
  const headings: string[] = [];
  const buttons: string[] = [];
  const labels: string[] = [];
  const visibleText: string[] = [];

  for (const candidate of input.candidates) {
    const text = truncate(candidate.text.trim(), MAX_TEXT_LENGTH);
    if (!text) continue;
    switch (candidate.kind) {
      case "heading":
        if (headings.length < MAX_HEADINGS) headings.push(text);
        break;
      case "button":
        if (buttons.length < MAX_BUTTONS) buttons.push(text);
        break;
      case "label":
        if (labels.length < MAX_LABELS) labels.push(text);
        break;
      case "text":
        if (visibleText.length < MAX_VISIBLE_TEXT_ITEMS) visibleText.push(text);
        break;
    }
  }

  const focused: PageContextFocusedElementDto | null = input.focused
    ? {
        tag: input.focused.tag,
        role: input.focused.role,
        label: input.focused.label ? truncate(input.focused.label.trim(), MAX_TEXT_LENGTH) : null
      }
    : null;

  const selectedText = input.selectedText
    ? truncate(input.selectedText.trim(), MAX_SELECTED_TEXT_LENGTH) || null
    : null;

  return {
    route: truncate(input.route.trim(), MAX_ROUTE_LENGTH),
    pageTitle: truncate(input.pageTitle.trim(), MAX_TITLE_LENGTH),
    headings,
    buttons,
    labels,
    visibleText,
    focused,
    selectedText,
    errors: input.errors ?? [],
    capturedAt: new Date().toISOString()
  };
}

/**
 * Project one candidate `data-jarvis-error-*` attribute triple into a {@link JarvisError},
 * or `null` when it's structurally invalid. A `prerequisite` error without a
 * `remediationRef` is dropped rather than surfaced without a fix (the map/tool contract
 * requires `class:"prerequisite"` to resolve to a named remediation).
 */
export function projectPageContextErrorAttributes(input: {
  readonly code: string | null;
  readonly errorClass: string | null;
  readonly remediationRef: string | null;
}): JarvisError | null {
  const code = input.code?.trim().slice(0, 160);
  const errorClass = input.errorClass as JarvisErrorClass | null;
  const remediationRef = input.remediationRef?.trim().slice(0, 160);
  if (!code || !errorClass || !ERROR_CLASSES.has(errorClass)) return null;
  if (errorClass === "prerequisite") {
    return remediationRef ? { code, class: errorClass, remediationRef } : null;
  }
  return { code, class: errorClass };
}

/**
 * Collect declared `[data-jarvis-error-code][data-jarvis-error-class]` markers under
 * `root` — the structured-error analogue of the text candidates above. Modules opt a
 * visible error surface into page context by setting those attributes; nothing here
 * infers an error from visible prose.
 */
export function collectPageContextErrors(root: ParentNode): readonly JarvisError[] {
  const errors: JarvisError[] = [];
  const nodes = root.querySelectorAll<HTMLElement>(
    "[data-jarvis-error-code][data-jarvis-error-class]"
  );
  for (const node of nodes) {
    if (errors.length === MAX_CONTEXT_ERRORS) break;
    const projected = projectPageContextErrorAttributes({
      code: node.dataset.jarvisErrorCode ?? null,
      errorClass: node.dataset.jarvisErrorClass ?? null,
      remediationRef: node.dataset.jarvisErrorRemediationRef ?? null
    });
    if (projected) errors.push(projected);
  }
  return errors;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

// ─── Intent heuristic (pure, unit-tested directly) ─────────────────────────────────

// Deliberately broad rather than narrow: a false positive costs one extra (redacted,
// capped) block in the prompt; a false negative means the user's "what does this
// button do?" question gets no page context at all. Kept as a standalone exported
// function so its judgment calls are easy to test and adjust independently of the
// capture/redaction logic above.
const CURRENT_PAGE_PATTERN =
  /\b(this page|this screen|this view|this tab|current page|what am i (looking at|on)|where am i|this button|this field|this form|this section|this list|this card|what does this|what is this|explain this|what('?s| is) (going on|here|on (my|the) screen)|on (my|this) screen)\b/i;

/**
 * Heuristic: does this user message plausibly ask about what is currently on screen?
 * Used to gate whether a page-context snapshot is captured and attached at all — page
 * context is opt-in-by-content, never sent by default (see chat-drawer.tsx sendMessage).
 */
export function asksAboutCurrentPage(text: string): boolean {
  return CURRENT_PAGE_PATTERN.test(text);
}

// ─── Real-DOM adapter (thin, mechanical, not unit-tested directly) ─────────────────

const CAPTURE_SELECTOR = "h1,h2,h3,h4,h5,h6,button,[role='button'],label,p,li";
const HEADING_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);

function elementPrivacySignals(el: Element): ElementPrivacySignals {
  const tag = el.tagName.toLowerCase();
  const type = tag === "input" ? (el.getAttribute("type") ?? "text").toLowerCase() : null;
  const autocomplete = el.getAttribute("autocomplete");
  let display: string | null = null;
  let visibility: string | null = null;
  try {
    const style = window.getComputedStyle(el);
    display = style.display;
    visibility = style.visibility;
  } catch {
    // getComputedStyle can throw for a detached element; treat as unknown (not hidden).
  }
  return {
    tag,
    type,
    autocomplete,
    hidden: el.hasAttribute("hidden"),
    ariaHidden: el.getAttribute("aria-hidden") === "true",
    display,
    visibility,
    noCapture:
      el.hasAttribute("data-jarvis-no-capture") || el.closest("[data-jarvis-no-capture]") !== null
  };
}

function candidateKindForTag(el: Element): PageContextCandidateKind | null {
  if (HEADING_TAGS.has(el.tagName)) return "heading";
  if (el.tagName === "BUTTON" || el.getAttribute("role") === "button") return "button";
  if (el.tagName === "LABEL") return "label";
  if (el.tagName === "P" || el.tagName === "LI") return "text";
  return null;
}

function focusInfo(el: Element): PageContextFocusInfo | null {
  const signals = elementPrivacySignals(el);
  if (isSensitiveElementSignals(signals) || isHiddenElementSignals(signals)) return null;
  const role = el.getAttribute("role");
  const ariaLabel = el.getAttribute("aria-label");
  const label = ariaLabel ?? (el.textContent ? el.textContent.trim() : null);
  return { tag: signals.tag, role, label: label && label.length > 0 ? label : null };
}

/**
 * Walk `root` and collect capture candidates, skipping any element (and its subtree,
 * via the sensitive/hidden ancestor checks folded into {@link elementPrivacySignals})
 * that fails either redaction check. Never reads `.value` off any form control.
 */
function collectPageContextCandidates(root: ParentNode): {
  candidates: PageContextCandidate[];
  focused: PageContextFocusInfo | null;
  selectedText: string | null;
  errors: readonly JarvisError[];
} {
  const candidates: PageContextCandidate[] = [];
  const elements = root.querySelectorAll(CAPTURE_SELECTOR);
  for (const el of elements) {
    const signals = elementPrivacySignals(el);
    if (isSensitiveElementSignals(signals) || isHiddenElementSignals(signals)) continue;
    const kind = candidateKindForTag(el);
    if (!kind) continue;
    const text = el.textContent?.trim();
    if (!text) continue;
    candidates.push({ kind, text });
  }

  const active = typeof document !== "undefined" ? document.activeElement : null;
  const focused =
    active && active instanceof Element && active !== document.body ? focusInfo(active) : null;

  return {
    candidates,
    focused,
    selectedText: readSelectedText(),
    errors: collectPageContextErrors(root)
  };
}

function readSelectedText(): string | null {
  try {
    const raw = window.getSelection?.()?.toString();
    return raw && raw.trim().length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Capture the current page snapshot. Safe to call from any browser event handler;
 * never throws (falls back to a minimal snapshot with empty lists on any DOM error).
 */
export function capturePageContextSnapshot(): PageContextSnapshotDto {
  const route = window.location.pathname;
  let pageTitle = route;
  try {
    pageTitle = resolvePageHeading(route).title;
  } catch {
    // fall back to the raw route
  }

  try {
    const { candidates, focused, selectedText, errors } = collectPageContextCandidates(
      document.body
    );
    return buildPageContextSnapshot({
      route,
      pageTitle,
      candidates,
      focused,
      selectedText,
      errors
    });
  } catch {
    return buildPageContextSnapshot({
      route,
      pageTitle,
      candidates: [],
      focused: null,
      selectedText: null,
      errors: []
    });
  }
}

/**
 * #679 — capture a page-context snapshot only when the message itself appears to ask
 * about the current page; returns undefined otherwise so page context is never attached
 * by default (on-demand-only capture is the whole point of the feature).
 */
export function maybeCapturePageContext(userText: string): PageContextSnapshotDto | undefined {
  return asksAboutCurrentPage(userText) ? capturePageContextSnapshot() : undefined;
}
