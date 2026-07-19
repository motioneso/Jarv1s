// #1084: renders the REAL component tree (InstanceModulesPane -> filterUndeclaredExternalModules
// -> ModuleCredentialsSection), not just the pure derivation functions covered by
// instance-modules-dedup.test.tsx — this is what actually regressed for an operator: the
// External-modules group (trust warning + #918 admin credentials) went permanently empty for
// every discovered module because registryIds was built from ALL registry rows instead of only
// index-backed ones (see settings-instance-modules-pane.tsx's registryIndexIds comment). Uses the
// same renderToString + pre-seeded QueryClient pattern as settings-admin-panes.test.tsx — no
// network mocking needed since every query this pane fires is pre-populated via setQueryData.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import type {
  ExternalModuleDto,
  GetModuleRegistryResponse,
  ListModuleCredentialsResponse,
  ListModulesResponse
} from "@jarv1s/shared";

import { queryKeys } from "../../apps/web/src/api/query-keys.js";
import { InstanceModulesPane } from "../../apps/web/src/settings/settings-instance-modules-pane.js";
import { FeedbackProvider } from "../../apps/web/src/settings/settings-feedback.js";

function renderWithQuery(client: QueryClient): string {
  return renderToString(
    createElement(
      QueryClientProvider,
      { client },
      createElement(FeedbackProvider, null, createElement(InstanceModulesPane))
    )
  );
}

// A module discovered on disk (boot-time load succeeded) that was never published to the
// registry index — the exact #1084 scenario ("operator drops a self-authored, never-published
// module in the modules dir").
const UNDECLARED_ID = "acme-undeclared";
// A module that IS registry-known (e.g. downloaded via the registry) — must NOT duplicate into
// the External-modules group; this is the case filterUndeclaredExternalModules is SUPPOSED to
// drop, so the test also proves the fix didn't just delete the filter entirely.
const DECLARED_ID = "acme-declared";

function seedClient(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.settings.adminModules, {
    modules: []
  } satisfies ListModulesResponse);
  client.setQueryData(queryKeys.settings.adminExternalModules, {
    enabled: true,
    modules: [
      {
        id: UNDECLARED_ID,
        name: "Acme Undeclared",
        version: "0.1.0",
        publisher: "Acme",
        status: "disabled",
        active: false,
        drifted: false,
        disabledReason: null,
        web: null
      },
      {
        id: DECLARED_ID,
        name: "Acme Declared",
        version: "0.1.0",
        publisher: "Acme",
        status: "enabled",
        active: true,
        drifted: false,
        disabledReason: null,
        web: null
      }
    ] satisfies readonly ExternalModuleDto[]
  });
  client.setQueryData(queryKeys.settings.adminModuleRegistry, {
    enabled: true,
    registryUnavailable: false,
    modules: [
      {
        id: UNDECLARED_ID,
        name: "Acme Undeclared",
        description: null,
        state: "installed-disabled",
        installedVersion: "0.1.0",
        // Local-only row: no registry-index entry backs it (module-registry-rows.ts leaves
        // latestVersion null for exactly this case) — the field registryIndexIds keys on.
        latestVersion: null,
        stagedVersion: null,
        requiresCore: null,
        capabilities: null,
        lastInstallError: null,
        purgePending: false
      },
      {
        id: DECLARED_ID,
        name: "Acme Declared",
        description: null,
        state: "installed-enabled",
        installedVersion: "0.1.0",
        // Backed by a registry-index entry -> registry-known -> must be excluded from the
        // External-modules group below (it already has its own row in Available modules).
        latestVersion: "0.1.0",
        stagedVersion: null,
        requiresCore: null,
        capabilities: null,
        lastInstallError: null,
        purgePending: false
      }
    ]
  } satisfies GetModuleRegistryResponse);
  // ModuleCredentialsSection's query key is a literal tuple (module-credentials-section.tsx),
  // not part of queryKeys — mirrored here rather than importing an internal constant.
  client.setQueryData(["module-credentials", "admin", UNDECLARED_ID], {
    moduleId: UNDECLARED_ID,
    credentials: [
      {
        credentialId: `${UNDECLARED_ID}.api-key`,
        displayName: "Acme API Key",
        scope: "instance",
        configured: false,
        updatedAt: null
      }
    ]
  } satisfies ListModuleCredentialsResponse);
  client.setQueryData(["module-credentials", "admin", DECLARED_ID], {
    moduleId: DECLARED_ID,
    credentials: [
      {
        credentialId: `${DECLARED_ID}.api-key`,
        displayName: "Declared API Key",
        scope: "instance",
        configured: false,
        updatedAt: null
      }
    ]
  } satisfies ListModuleCredentialsResponse);
  return client;
}

describe("InstanceModulesPane external-modules group (#1084)", () => {
  it("shows the trusted-operator warning for a discovered-but-unpublished module", () => {
    const html = renderWithQuery(seedClient());
    expect(html).toContain("External modules are not reviewed by Jarvis");
    expect(html).toContain("Acme Undeclared");
  });

  it("renders the #918 admin credentials section for that module (not silently dropped)", () => {
    const html = renderWithQuery(seedClient());
    expect(html).toContain("Acme API Key");
  });

  it("renders admin credentials for a registry-installed module (#1176)", () => {
    const html = renderWithQuery(seedClient());
    expect(html).toContain("Declared API Key");
  });

  it("does not duplicate a registry-known module into the External-modules group", () => {
    const html = renderWithQuery(seedClient());
    // DECLARED_ID is registry-known (latestVersion set) — filterUndeclaredExternalModules
    // must drop it from this group, so its name/version line appears exactly once (from
    // ModuleRegistrySection's "Available modules" list), not a second time here. Matching on
    // the Row's version-line text (not just the name) targets the actual rendered row rather
    // than an incidental second mention of "Acme Declared" elsewhere on the pane.
    const versionLineOccurrences = html.split("Acme · v0.1.0").length - 1;
    expect(versionLineOccurrences).toBeLessThanOrEqual(1);
    // The genuinely-undeclared module still renders its own Row in this group — proves the
    // filter didn't just start dropping everything.
    expect(html).toContain("Acme Undeclared");
  });
});
