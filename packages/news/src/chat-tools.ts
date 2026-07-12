import type { PgBoss } from "pg-boss";

import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";
import type { ToolExecute, ToolResult, ToolSummarize } from "@jarv1s/module-sdk";

import type { NewsAiPort, NewsSafeFetchPort, NewsWebSearchPort } from "./discovery/ports.js";
import { resolveSourceInput, type SourceResolutionResult } from "./discovery/source-resolution.js";
import {
  confirmSourceFromPreview,
  type NewsPersonalizationStore,
  type NewsSourcePreviewStore
} from "./personalization-routes.js";

/**
 * Assistant-chat surface for custom news sources (#975 Slice 4). Mirrors the
 * REST preview/confirm pair (`personalization-routes.ts`) over the SAME shared
 * preview store, so a source previewed in chat can be confirmed over REST and
 * vice versa. Only preview + confirm exist as chat tools — source edit and
 * exclusion removal stay REST-only per the approved plan.
 *
 * Deferred-deps seam mirrors `briefing-tool.ts`: the manifest is static
 * import-time data, but the discovery ports/boss/repository only exist once
 * the composition root runs — `registerNewsRoutes` calls
 * `configureNewsChatTools` during boot, strictly before any chat request can
 * reach these executes.
 */
export interface NewsChatToolDependencies {
  readonly previews: NewsSourcePreviewStore;
  readonly discovery: {
    readonly fetch: NewsSafeFetchPort;
    readonly search: NewsWebSearchPort;
    readonly ai: NewsAiPort;
  };
  readonly availability: {
    hasJsonModel(scopedDb: DataContextDb): Promise<boolean>;
    hasWebSearch(scopedDb: DataContextDb): Promise<boolean>;
  };
  readonly boss: PgBoss | null;
  readonly repository: NewsPersonalizationStore;
}

let deps: NewsChatToolDependencies | undefined;

export function configureNewsChatTools(config: NewsChatToolDependencies): void {
  deps = config;
}

function requireDeps(): NewsChatToolDependencies {
  if (!deps) {
    throw new Error(
      "news chat tools used before configureNewsChatTools ran (composition-root bug)"
    );
  }
  return deps;
}

/** Benign resolution failures become tool data the model can relay — never throws. */
function describeResolutionFailure(result: SourceResolutionResult): string {
  if (result.status === "rejected") {
    switch (result.reason) {
      case "policy":
        return "That publisher is not allowed by content policy.";
      case "invalid_input":
        return "That doesn't look like a news publisher URL or name.";
      case "not_https":
        return "Publisher sites must be reachable over HTTPS.";
      case "unreachable":
        return "Could not reach or verify that publisher.";
    }
  }
  return "Source discovery is currently unavailable — try again later.";
}

/**
 * `news.previewSource`: read-risk verification pass. Output NEVER includes
 * `feedUrl` or `validationFingerprint` — provider/model-derived material stays
 * server-side in the preview store; confirm re-reads the stored candidate.
 */
export const newsPreviewSourceExecute: ToolExecute = async (
  scopedDb,
  input,
  ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const d = requireDeps();
  const rawInput = (input as { source?: unknown }).source;
  const raw = typeof rawInput === "string" ? rawInput.trim() : "";
  if (!raw) return { data: { error: "Provide a publisher URL or name to preview." } };

  const [hasJsonModel, hasWebSearch] = await Promise.all([
    d.availability.hasJsonModel(scopedDb),
    d.availability.hasWebSearch(scopedDb)
  ]);
  if (!hasJsonModel) {
    return { data: { error: "Custom news sources require a configured AI model." } };
  }
  const result = await resolveSourceInput(
    scopedDb,
    { ...d.discovery, repo: d.repository },
    { raw, hasWebSearch }
  );
  if (result.status !== "ok" && result.status !== "ambiguous") {
    return { data: { error: describeResolutionFailure(result) } };
  }

  // Chat previews never target a replacement — edit stays REST-only.
  const confirmationId = d.previews.put({
    ownerUserId: ctx.actorUserId,
    candidates: result.candidates,
    replaceSourceId: null,
    createdAt: Date.now()
  });
  const existing = await d.repository.listCustomSources(scopedDb);
  const duplicate = result.candidates
    .map((candidate) =>
      existing.find((source) => source.canonicalDomain === candidate.canonicalDomain)
    )
    .find(Boolean);
  return {
    data: {
      confirmationId,
      candidates: result.candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        label: candidate.label,
        domain: candidate.canonicalDomain
      })),
      ...(duplicate ? { duplicateOfSourceId: duplicate.id } : {})
    }
  };
};

/**
 * `news.confirmSource`: always confirm-gated (no actionFamilyId in the
 * manifest, so the gateway never promotes it past the owner prompt). The
 * resubmitted label/domain are the tamper check against the stored candidate —
 * see `confirmSourceFromPreview`.
 */
export const newsConfirmSourceExecute: ToolExecute = async (
  scopedDb,
  input,
  ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const d = requireDeps();
  const body = input as {
    confirmationId: string;
    candidateId?: string;
    label: string;
    domain: string;
  };
  const outcome = await confirmSourceFromPreview(
    scopedDb,
    { previews: d.previews, repository: d.repository, boss: d.boss },
    ctx.actorUserId,
    {
      confirmationId: body.confirmationId,
      candidateId: body.candidateId,
      expected: { label: body.label, domain: body.domain }
    }
  );
  if (!outcome.ok) return { data: { error: outcome.message } };
  // Echo display fields only — never the stored fingerprint/feedUrl.
  return {
    data: { source: { label: outcome.source.label, domain: outcome.source.canonicalDomain } }
  };
};

/** Confirmation prompt text comes from tool INPUT only — execute hasn't run yet. */
export const summarizeNewsConfirmSource: ToolSummarize = (input) => {
  const body = input as { label?: unknown; domain?: unknown };
  const label = typeof body.label === "string" ? body.label : "custom source";
  const domain = typeof body.domain === "string" ? body.domain : "unknown domain";
  return `Add news source "${label}" (${domain})`;
};
