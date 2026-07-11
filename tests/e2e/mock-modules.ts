import { readFileSync } from "node:fs";

import type { Page } from "@playwright/test";
import type {
  ExternalModuleDto,
  ListExternalModulesResponse,
  ListModulesResponse,
  ListMyModulesResponse,
  ModuleDto
} from "@jarv1s/shared";

export const modulesResponse: ListModulesResponse = {
  modules: [
    {
      id: "connectors",
      name: "Connectors",
      version: "0.1.0",
      lifecycle: "required",
      navigation: [],
      settings: [
        {
          id: "connectors.user-settings",
          label: "Connectors",
          path: "/settings/connectors",
          scope: "user",
          order: 30
        }
      ]
    },
    {
      id: "tasks",
      name: "Tasks",
      version: "0.1.0",
      lifecycle: "required",
      navigation: [
        {
          id: "tasks",
          label: "Tasks",
          path: "/tasks",
          icon: "check-square",
          order: 10
        }
      ],
      settings: []
    },
    {
      id: "notifications",
      name: "Notifications",
      version: "0.1.0",
      lifecycle: "required",
      navigation: [
        {
          id: "notifications",
          label: "Notifications",
          path: "/notifications",
          icon: "bell",
          order: 30
        }
      ],
      settings: []
    },
    {
      id: "calendar",
      name: "Calendar",
      version: "0.1.0",
      lifecycle: "required",
      navigation: [
        {
          id: "calendar",
          label: "Calendar",
          path: "/calendar",
          icon: "calendar-days",
          order: 35
        }
      ],
      settings: []
    },
    {
      id: "email",
      name: "Email",
      version: "0.1.0",
      lifecycle: "required",
      navigation: [
        {
          id: "email",
          label: "Email",
          path: "/email",
          icon: "mail",
          order: 40
        }
      ],
      settings: []
    },
    {
      id: "ai",
      name: "AI",
      version: "0.1.0",
      lifecycle: "required",
      navigation: [],
      settings: [
        {
          id: "ai.user-settings",
          label: "AI Providers",
          path: "/settings/ai",
          scope: "user",
          order: 40
        }
      ]
    },
    {
      id: "chat",
      name: "Chat",
      version: "0.1.0",
      lifecycle: "required",
      navigation: [
        {
          id: "chat",
          label: "Chat",
          path: "/chat",
          icon: "message-square",
          order: 45
        }
      ],
      settings: []
    },
    {
      id: "briefings",
      name: "Briefings",
      version: "0.1.0",
      lifecycle: "required",
      navigation: [
        {
          id: "briefings",
          label: "Briefings",
          path: "/briefings",
          icon: "newspaper",
          order: 50
        }
      ],
      settings: []
    },
    {
      id: "settings",
      name: "Settings",
      version: "0.0.0",
      lifecycle: "required",
      navigation: [
        {
          id: "settings",
          label: "Settings",
          path: "/settings",
          icon: "settings",
          order: 1000
        }
      ],
      settings: []
    }
  ]
};

/**
 * Per-actor enablement flags for the same module set, all active — the shell hides nav only
 * for modules the actor has explicitly disabled, so the default fixture keeps the full nav.
 */
export const myModulesResponse: ListMyModulesResponse = {
  modules: modulesResponse.modules.map((module) => ({
    id: module.id,
    name: module.name,
    version: module.version,
    lifecycle: module.lifecycle,
    required: module.lifecycle === "required",
    supportsUserDisable: module.lifecycle === "user-toggleable",
    instanceDisabled: false,
    userDisabled: false,
    active: true
  }))
};

/**
 * Stateful mock for the #917 external-modules admin surface (Settings → Instance modules).
 * Seeds one discovered-but-inactive module; the POST toggle flips its status in-memory so the
 * pane round-trips (enable → refetch shows the switch checked), mirroring the stateful handlers
 * in mock-api.ts (e.g. handleAdminUsersRoute).
 *
 * MUST be registered AFTER mockApi(page, …): Playwright matches the most-recently-registered
 * route first, so these override mockApi's catch-all 404 for /api/*.
 */
export async function mockExternalModules(page: Page): Promise<void> {
  // `enabled:true` mirrors the server having JARVIS_ENABLE_EXTERNAL_MODULES=1; without it the
  // pane hides the whole section (the fail-closed default), so the feature-on path needs it true.
  let current: ExternalModuleDto = {
    id: "acme-widgets",
    name: "Acme Widgets",
    version: "0.1.0",
    publisher: "Acme, Inc.",
    status: "discovered",
    active: false,
    drifted: false,
    disabledReason: null,
    web: null
  };

  // GET list — the pane's initial query and every post-toggle refetch read this.
  await page.route("**/api/admin/external-modules", async (route) => {
    const body: ListExternalModulesResponse = { enabled: true, modules: [current], rejected: [] };
    await route.fulfill({ json: body });
  });

  // POST /api/admin/external-modules/:id — flip the module's status so the refetched list
  // reflects the new enablement, matching the real endpoint's { module } envelope.
  await page.route("**/api/admin/external-modules/*", async (route) => {
    const enabled = (route.request().postDataJSON() as { enabled: boolean }).enabled;
    current = {
      ...current,
      status: enabled ? "enabled" : "disabled",
      active: enabled
    };
    await route.fulfill({ json: { module: current } });
  });
}

/**
 * #916 — mount a fake ENABLED external web module and serve its bundle, so the e2e can drive the
 * real button-click → host-action → editable-draft flow. Registered AFTER mockApi so these routes
 * win (Playwright matches most-recently-registered first).
 *
 * The served bundle is valid ESM: it reads the host React from the runtime global the loader
 * installs at boot (window.__JARVIS_MODULE_RUNTIME__), so exactly one React instance exists, and
 * its Root calls the host action from a user gesture — no JSX/transpile needed to serve it as text.
 */
export async function mockExternalWebModule(page: Page): Promise<void> {
  const moduleId = "job-search";
  const entrypoint = "dist/web/index.js";

  const externalEntry = {
    id: moduleId,
    name: "Job Search",
    version: "0.1.0",
    lifecycle: "optional" as const,
    external: true,
    web: { entrypoint, contractVersion: 1 },
    navigation: [{ id: moduleId, label: "Job Search", path: `/m/${moduleId}`, order: 60 }],
    settings: []
  };

  // /api/modules — the app.tsx externalModuleRoutes filter needs external:true + web set.
  await page.route("**/api/modules", async (route) => {
    const body: ListModulesResponse = {
      modules: [...modulesResponse.modules, externalEntry as unknown as ModuleDto]
    };
    await route.fulfill({ json: body });
  });

  // /api/me/modules — mark it active so the module is enabled for the actor.
  await page.route("**/api/me/modules", async (route) => {
    const body: ListMyModulesResponse = {
      modules: [
        ...myModulesResponse.modules,
        {
          id: moduleId,
          name: "Job Search",
          version: "0.1.0",
          lifecycle: "optional",
          required: false,
          supportsUserDisable: true,
          instanceDisabled: false,
          userDisabled: false,
          active: true
        }
      ]
    };
    await route.fulfill({ json: body });
  });

  // The bundle itself — a real ESM module whose Root invokes the host action from a click.
  // Trailing `*` (not an exact match): the dev-time `import(url)` in loader.ts hits an absolute
  // URL Vite doesn't own, so its browser client appends a `?import` query suffix to the request —
  // an exact-path glob 404s on that suffix, which only ever shows up under Vite dev, never prod
  // (Fastify route matching ignores query strings there).
  await page.route(`**/api/modules/${moduleId}/web/${entrypoint}*`, async (route) => {
    const bundle = [
      "const { react: React } = window.__JARVIS_MODULE_RUNTIME__;",
      "export default {",
      "  contractVersion: 1,",
      "  Root: (props) => React.createElement('button', {",
      "    type: 'button',",
      "    onClick: () => props.hostActions.openAssistant({ starterPrompt: 'Help me start my job search.' })",
      "  }, 'Continue with Jarvis')",
      "};"
    ].join("\n");
    await route.fulfill({
      contentType: "text/javascript; charset=utf-8",
      body: bundle
    });
  });
}

/**
 * JS-06 (#935) — options for {@link mockExternalWebModuleFromDist}.
 *
 * - `invokeFixtures`: per-tool `invocation.result` payloads keyed by tool name; merged over the
 *   defaults (onboarding paused at step "profile", empty monitor list). Tools with no fixture
 *   resolve succeeded with `{}` so a missing key degrades a row, never the whole surface.
 * - `runNowJobIds`: successive `jobId` values the run-now queue route returns (202 each). The
 *   default `["job-1", null]` exercises queued-then-already-queued; `null` is the #965 dedupe
 *   contract the client must honor even though the host doesn't emit it yet.
 * - `invokeStatus`: force every invoke to this HTTP status (e.g. 404 = module disabled
 *   server-side) to prove the stale-session fail-closed path.
 */
export type DistModuleMockOptions = {
  invokeFixtures?: Record<string, Record<string, unknown>>;
  runNowJobIds?: Array<string | null>;
  invokeStatus?: number;
};

// Playwright runs from the repo root (config lives there), so a cwd-relative path is stable —
// same convention as the capture-screens harness's test-results/ output dir.
const JOB_SEARCH_DIST_BUNDLE = "external-modules/job-search/dist/web/index.js";

const DEFAULT_INVOKE_FIXTURES: Record<string, Record<string, unknown>> = {
  // Mid-onboarding (3 of 6 done, resume approved) so Overview shows real progress and the
  // "Continue with Jarvis" handoff button is present (step !== "done").
  "job-search.onboarding.get-state": {
    step: "profile",
    completed: { resume_intake: true, resume_critique: true, resume_approval: true },
    gates: { resumeApproved: true, profileApproved: false, monitorEnabled: false }
  },
  "job-search.monitor.list": { monitors: [] }
};

/**
 * JS-06 (#935) — mount the REAL job-search web bundle (esbuild output on disk) instead of the
 * inline stub above, plus the two data-plane routes the surface talks to (risk:read tool invokes
 * and the run-now queue route). Callers must run `pnpm build:external:job-search` first (the spec
 * does it in beforeAll) and register this AFTER mockApi so these routes beat its catch-all 404.
 *
 * Registration order matters: the listing/bundle routes from mockExternalWebModule go first, then
 * the dist bundle route re-registers the same glob — Playwright matches most-recently-registered
 * first, so the real bundle wins over the inline stub.
 */
export async function mockExternalWebModuleFromDist(
  page: Page,
  options?: DistModuleMockOptions
): Promise<void> {
  await mockExternalWebModule(page);

  // Real bundle from disk. Same trailing-`*` glob as above (Vite dev appends `?import`). Read
  // lazily per request so beforeAll's build always wins over any stale file at register time.
  await page.route(`**/api/modules/job-search/web/dist/web/index.js*`, async (route) => {
    await route.fulfill({
      contentType: "text/javascript; charset=utf-8",
      body: readFileSync(JOB_SEARCH_DIST_BUNDLE, "utf8")
    });
  });

  // risk:read tool invokes — the module surface's only data plane (Coordinator ruling: reads via
  // the invoke route, write tools never from REST). Envelope mirrors the real route's
  // { invocation: { status, result } } shape that web/api.ts unwraps.
  const fixtures = { ...DEFAULT_INVOKE_FIXTURES, ...options?.invokeFixtures };
  await page.route("**/api/ai/assistant-tools/*/invoke*", async (route) => {
    if (options?.invokeStatus !== undefined) {
      await route.fulfill({ status: options.invokeStatus, json: { error: "not found" } });
      return;
    }
    const pathname = new URL(route.request().url()).pathname;
    const match = /\/assistant-tools\/([^/]+)\/invoke$/.exec(pathname);
    const tool = decodeURIComponent(match?.[1] ?? "");
    await route.fulfill({
      json: { invocation: { status: "succeeded", result: fixtures[tool] ?? {} } }
    });
  });

  // Run-now queue route — 202 + jobId per the host contract; jobId:null = manual singleton
  // already queued (#965 dedupe contract, mock-driven until the host emits it).
  const jobIds = options?.runNowJobIds ?? ["job-1", null];
  let runNowCalls = 0;
  await page.route(
    "**/api/modules/job-search/queues/job-search.monitor-run/run*",
    async (route) => {
      const jobId = jobIds[Math.min(runNowCalls, jobIds.length - 1)] ?? null;
      runNowCalls += 1;
      await route.fulfill({ status: 202, json: { jobId } });
    }
  );
}
