import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Sanctioned-coupling allowlist test (#802 module boundary enforcement).
 *
 * "Modules collaborate only through declared public APIs/events. No module imports another
 * module's internals" is a Hard Invariant, but nothing previously stopped a *new*
 * feature-to-feature workspace dependency from appearing silently — every coupling that exists
 * today was added one `package.json` line at a time, with no single place recording which ones
 * are intentional. This test derives the complete feature -> feature dependency edge set from
 * the actual package graph and pins it against an explicit allowlist: adding a new edge means
 * touching `SANCTIONED_FEATURE_COUPLINGS` in this file, a visible, reviewable act (and, per the
 * Hard Invariant, one that needs a spec-level justification — see CLAUDE.md "Module isolation").
 *
 * This gate freezes the status quo; it does not relitigate it. Every edge below already existed
 * in the real dependency graph at the time this test was written (2026-07). Some were previously
 * *undeclared* (resolved only via pnpm's hoisted `node_modules`) and were made honest by the
 * companion `check:package-deps` gate in the same PR — see `chat -> email` / `chat -> notes`,
 * which existed in `packages/chat/src/**` before their `package.json` entries did.
 *
 * Classification (platform vs. feature) is architectural judgment, not derived from any single
 * metadata field — `ModuleManifest` exports exist on both platform and feature packages (e.g.
 * `@jarv1s/ai`, `@jarv1s/memory`, `@jarv1s/settings` all register one), so manifest presence
 * alone doesn't distinguish them. The criterion used here: a package is **platform** if it is
 * cross-cutting infrastructure with no independent, end-user-visible product domain of its own
 * (storage, job queue, auth, generic settings/preferences plumbing, AI routing, ranking/scoring
 * primitives, the composition root) — consumed broadly across feature packages and by other
 * platform packages. A package is **feature** if it represents a distinct product capability a
 * user recognizes as its own area (calendar, chat, connectors, notes, tasks, sports, weather...).
 * Platform packages sometimes depend on feature packages (e.g. `@jarv1s/jobs`, platform, depends
 * on `@jarv1s/notifications`, feature, to write an upgrade notice) — that's expected of hub
 * packages and is intentionally *not* tracked here; only feature -> feature edges are pinned.
 */

const packagesRoot = join(process.cwd(), "packages");

/** Platform: cross-cutting infrastructure, no independent end-user product domain. */
const PLATFORM_PACKAGES = new Set([
  "@jarv1s/ai", // provider-agnostic AI capability router (CLAUDE.md invariant), not a feature
  "@jarv1s/auth",
  "@jarv1s/datasets", // dataset connector SDK runtime host (host pinning, cache, TTL) — infra, not a product domain
  "@jarv1s/db",
  "@jarv1s/host-fetch", // shared server-only outbound network policy/transport
  "@jarv1s/jobs",
  "@jarv1s/memory",
  "@jarv1s/module-registry", // composition root; wires every module together
  "@jarv1s/module-sdk",
  "@jarv1s/module-web-sdk", // browser-safe frontend contribution SDK (routes/widgets/palette), infra not a product domain
  "@jarv1s/priority", // ranking/ordering primitive; consumed by @jarv1s/shared itself
  "@jarv1s/settings", // generic settings/audit-log hub — "platform packages are expected hubs"
  "@jarv1s/settings-ui",
  "@jarv1s/shared",
  "@jarv1s/source-behaviors", // cross-cutting input-signal weighting for briefings/settings
  "@jarv1s/structured-state", // generic preferences/state store used across features
  "@jarv1s/usefulness-feedback", // cross-cutting feedback-loop signal, no product page of its own
  "@jarv1s/vault"
]);

/** Feature: a distinct, user-recognizable product capability. */
const FEATURE_PACKAGES = new Set([
  "@jarv1s/briefings",
  "@jarv1s/calendar",
  "@jarv1s/chat",
  "@jarv1s/cli-runner",
  "@jarv1s/commitments",
  "@jarv1s/connectors",
  "@jarv1s/email",
  "@jarv1s/goals",
  "@jarv1s/news",
  "@jarv1s/notes",
  "@jarv1s/notifications",
  "@jarv1s/people",
  "@jarv1s/proactive-monitoring",
  "@jarv1s/sports",
  "@jarv1s/tasks",
  "@jarv1s/weather",
  "@jarv1s/web-research",
  "@jarv1s/wellness"
]);

/**
 * The complete, pre-sanctioned feature -> feature coupling set, derived from the actual package
 * graph (not copied from the design spec's illustrative example, which was explicitly
 * known-incomplete). Adding an edge here is a visible act requiring review.
 */
const SANCTIONED_FEATURE_COUPLINGS = [
  "@jarv1s/briefings -> @jarv1s/notifications",
  "@jarv1s/chat -> @jarv1s/calendar",
  "@jarv1s/chat -> @jarv1s/connectors",
  "@jarv1s/chat -> @jarv1s/email",
  "@jarv1s/chat -> @jarv1s/notes",
  "@jarv1s/chat -> @jarv1s/tasks",
  "@jarv1s/cli-runner -> @jarv1s/chat",
  "@jarv1s/connectors -> @jarv1s/calendar",
  "@jarv1s/connectors -> @jarv1s/email"
].sort();

interface PackageManifest {
  readonly name: string;
  readonly dependencyNames: readonly string[];
}

function listWorkspacePackages(): PackageManifest[] {
  const entries = readdirSync(packagesRoot, { withFileTypes: true }).filter((entry) =>
    entry.isDirectory()
  );

  const manifests: PackageManifest[] = [];
  for (const entry of entries) {
    const manifestPath = join(packagesRoot, entry.name, "package.json");
    let raw: string;
    try {
      raw = readFileSync(manifestPath, "utf8");
    } catch {
      continue; // not a real package (no package.json)
    }

    const parsed = JSON.parse(raw) as {
      name?: string;
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    if (!parsed.name) continue;

    manifests.push({
      name: parsed.name,
      dependencyNames: [
        ...Object.keys(parsed.dependencies ?? {}),
        ...Object.keys(parsed.peerDependencies ?? {})
      ].filter((dep) => dep.startsWith("@jarv1s/"))
    });
  }

  return manifests;
}

function deriveFeatureToFeatureEdges(manifests: readonly PackageManifest[]): string[] {
  const edges: string[] = [];
  for (const manifest of manifests) {
    if (!FEATURE_PACKAGES.has(manifest.name)) continue;
    for (const dependency of manifest.dependencyNames) {
      if (FEATURE_PACKAGES.has(dependency)) {
        edges.push(`${manifest.name} -> ${dependency}`);
      }
    }
  }
  return edges.sort();
}

describe("module dependency allowlist (#802 module boundary enforcement)", () => {
  const manifests = listWorkspacePackages();

  it("classifies every workspace package as platform or feature", () => {
    const unclassified = manifests
      .map((manifest) => manifest.name)
      .filter((name) => !PLATFORM_PACKAGES.has(name) && !FEATURE_PACKAGES.has(name));

    expect(
      unclassified,
      `New/renamed package(s) not classified in this test: ${unclassified.join(", ")}. ` +
        "Add them to PLATFORM_PACKAGES or FEATURE_PACKAGES."
    ).toEqual([]);
  });

  it("has no package double-classified as both platform and feature", () => {
    const overlap = [...PLATFORM_PACKAGES].filter((name) => FEATURE_PACKAGES.has(name));
    expect(overlap).toEqual([]);
  });

  it("matches the complete feature -> feature edge set against the sanctioned allowlist", () => {
    const derivedEdges = deriveFeatureToFeatureEdges(manifests);
    expect(derivedEdges).toEqual(SANCTIONED_FEATURE_COUPLINGS);
  });
});
