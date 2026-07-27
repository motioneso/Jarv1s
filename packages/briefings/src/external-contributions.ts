// packages/briefings/src/external-contributions.ts
//
// #1282 Task 2 (composer half): external (JSON-manifest) modules cannot register an
// in-process assistant tool, so they can never be resolved via findExecute() the way core
// briefing sections are. This file is the trust boundary where a worker invocation result
// from an external module — arbitrary, untrusted JSON — is turned into a typed
// BriefingContribution or dropped. Every string that survives is sanitizeExternal()'d
// before it leaves this file, so callers never have to re-sanitize.
import { sanitizeExternal } from "./trust-boundary.js";
import type { JsonJarvisModuleManifest } from "@jarv1s/module-sdk";

// One module cannot flood a briefing (a hostile or buggy module returning thousands of
// items must not blow the prompt budget), and headline/title/detail get hard length caps
// for the same reason — a briefing line, not a document.
export const MAX_ITEMS = 20;
export const MAX_HEADLINE = 200;
export const MAX_TITLE = 200;
export const MAX_DETAIL = 500;

export interface BriefingContributionItem {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly href?: string;
}

export interface BriefingContribution {
  /** Module id, so the composer can attribute and the user can mute per module. */
  readonly moduleId: string;
  /** Short headline the composer may use verbatim. Rendered from records. */
  readonly headline: string;
  /** Zero or more structured items, already capped at MAX_ITEMS. */
  readonly items: readonly BriefingContributionItem[];
}

export type ExternalBriefingInvoker = (args: {
  readonly moduleId: string;
  readonly handler: string;
  readonly actorUserId: string;
  readonly requestId: string;
  readonly section: "morning" | "evening";
}) => Promise<unknown>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// L17 (ledger, overriding this task's own looser plan-doc prose "path or http(s)
// absolute"): a briefing item links to an in-app deep link only. A single leading `/` is
// required and a leading `//` is rejected — a scheme-relative `//evil.example/x` is a
// same-origin-looking string a browser still resolves off-origin. No scheme is ever
// accepted: `javascript:`/`data:` hrefs are an injection vector, not a display concern.
function isSafeHref(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//");
}

function parseItem(raw: unknown): BriefingContributionItem | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  if (
    !isNonEmptyString(record.id) ||
    !isNonEmptyString(record.title) ||
    !isNonEmptyString(record.detail)
  ) {
    // One malformed item is dropped without discarding the whole contribution — a strict
    // parser would cost the user the entire section over one bad record.
    return undefined;
  }
  const href = isSafeHref(record.href) ? record.href : undefined;
  return {
    id: sanitizeExternal(record.id),
    title: sanitizeExternal(record.title).slice(0, MAX_TITLE),
    detail: sanitizeExternal(record.detail).slice(0, MAX_DETAIL),
    ...(href !== undefined ? { href } : {})
  };
}

function parseContribution(moduleId: string, raw: unknown): BriefingContribution | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  // A malformed headline drops the whole contribution — unlike a bad item, there is no
  // sane fallback headline to show for a module's briefing block.
  if (!isNonEmptyString(record.headline)) return undefined;
  const rawItems = Array.isArray(record.items) ? record.items : [];
  const items = rawItems
    .map(parseItem)
    .filter((item): item is BriefingContributionItem => item !== undefined)
    .slice(0, MAX_ITEMS);
  return {
    moduleId,
    headline: sanitizeExternal(record.headline).slice(0, MAX_HEADLINE),
    items
  };
}

export async function collectExternalBriefingContributions(args: {
  readonly manifests: readonly JsonJarvisModuleManifest[];
  readonly selectedToolNames: readonly string[];
  readonly section: "morning" | "evening";
  readonly actorUserId: string;
  readonly requestId: string;
  readonly invoke: ExternalBriefingInvoker;
}): Promise<BriefingContribution[]> {
  // selected_tool_names is the user's gate, exactly as for every core section (and it is
  // applied here, before any invocation — an unselected module must never be run at all,
  // not run-then-filtered).
  const candidates = args.manifests.filter(
    (manifest) =>
      manifest.briefing !== undefined &&
      args.selectedToolNames.includes(manifest.briefing.toolName) &&
      manifest.briefing.sections.includes(args.section)
  );

  const results = await Promise.all(
    candidates.map(async (manifest) => {
      // Non-null: filtered on manifest.briefing !== undefined above.
      const briefing = manifest.briefing!;
      try {
        const raw = await args.invoke({
          moduleId: manifest.id,
          handler: briefing.handler,
          actorUserId: args.actorUserId,
          requestId: args.requestId,
          section: args.section
        });
        return parseContribution(manifest.id, raw);
      } catch {
        // A module that cannot answer must not take the whole briefing down (J3). This
        // swallows both a rejected invoke() and a trust-gate `{ok: false, ...}` that the
        // caller chose to throw on — the composed output is what a test may assert on,
        // never a rejection.
        return undefined;
      }
    })
  );

  return results.filter((contribution): contribution is BriefingContribution => {
    return contribution !== undefined;
  });
}
