import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    alias: [
      // The root test suite can render @jarv1s/web React components (e.g. the onboarding
      // multiplexer step). react / react-dom / react-query are workspace deps of
      // @jarv1s/web only, so resolve them from the web package's installed copies rather
      // than duplicating them as root devDependencies.
      {
        find: "react-dom",
        replacement: fileURLToPath(new URL("./apps/web/node_modules/react-dom", import.meta.url))
      },
      {
        find: "react",
        replacement: fileURLToPath(new URL("./apps/web/node_modules/react", import.meta.url))
      },
      {
        find: "@tanstack/react-query",
        replacement: fileURLToPath(
          new URL("./apps/web/node_modules/@tanstack/react-query", import.meta.url)
        )
      },
      {
        // react-router is a @jarv1s/web-only dep; resolve it from the web package's copy so the
        // root suite can render web components that use <Link> / <MemoryRouter> (#369 empty-chat).
        find: "react-router",
        replacement: fileURLToPath(new URL("./apps/web/node_modules/react-router", import.meta.url))
      },
      {
        find: "@jarv1s/ai",
        replacement: fileURLToPath(new URL("./packages/ai/src/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/auth",
        replacement: fileURLToPath(new URL("./packages/auth/src/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/briefings",
        replacement: fileURLToPath(new URL("./packages/briefings/src/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/calendar",
        replacement: fileURLToPath(new URL("./packages/calendar/src/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/chat/priority-consumer",
        replacement: fileURLToPath(
          new URL("./packages/chat/src/priority-consumer.ts", import.meta.url)
        )
      },
      {
        // Subpath export (#802); must precede the bare "@jarv1s/chat" alias below.
        find: "@jarv1s/chat/live",
        replacement: fileURLToPath(new URL("./packages/chat/src/live/public.ts", import.meta.url))
      },
      {
        find: "@jarv1s/chat",
        replacement: fileURLToPath(new URL("./packages/chat/src/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/db/probes",
        replacement: fileURLToPath(new URL("./packages/db/src/probes/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/commitments/tools",
        replacement: fileURLToPath(new URL("./packages/commitments/src/tools.ts", import.meta.url))
      },
      {
        find: "@jarv1s/commitments/routes",
        replacement: fileURLToPath(new URL("./packages/commitments/src/routes.ts", import.meta.url))
      },
      {
        find: "@jarv1s/commitments/workers",
        replacement: fileURLToPath(
          new URL("./packages/commitments/src/workers.ts", import.meta.url)
        )
      },
      {
        find: "@jarv1s/commitments/jobs",
        replacement: fileURLToPath(new URL("./packages/commitments/src/jobs.ts", import.meta.url))
      },
      {
        find: "@jarv1s/commitments/extractor",
        replacement: fileURLToPath(
          new URL("./packages/commitments/src/extractor.ts", import.meta.url)
        )
      },
      {
        find: "@jarv1s/commitments/prefilter",
        replacement: fileURLToPath(
          new URL("./packages/commitments/src/prefilter.ts", import.meta.url)
        )
      },
      {
        find: "@jarv1s/commitments/signature",
        replacement: fileURLToPath(
          new URL("./packages/commitments/src/signature.ts", import.meta.url)
        )
      },
      {
        find: "@jarv1s/commitments",
        replacement: fileURLToPath(new URL("./packages/commitments/src/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/connectors/presets",
        replacement: fileURLToPath(
          new URL("./packages/connectors/src/imap-presets.ts", import.meta.url)
        )
      },
      {
        find: "@jarv1s/connectors",
        replacement: fileURLToPath(new URL("./packages/connectors/src/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/datasets",
        replacement: fileURLToPath(new URL("./packages/datasets/src/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/db",
        replacement: fileURLToPath(new URL("./packages/db/src/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/email",
        replacement: fileURLToPath(new URL("./packages/email/src/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/jobs",
        replacement: fileURLToPath(new URL("./packages/jobs/src/index.ts", import.meta.url))
      },
      {
        // Server-only subpath export (#917); must precede the bare "@jarv1s/module-registry"
        // alias below. The root vitest suite resolves @jarv1s/* via this alias map rather than
        // the package.json "exports" map, so subpaths need an explicit entry — matching the
        // established @jarv1s/module-sdk/core-version, @jarv1s/chat/live, @jarv1s/db/probes pattern.
        find: "@jarv1s/module-registry/node",
        replacement: fileURLToPath(
          new URL("./packages/module-registry/src/node.ts", import.meta.url)
        )
      },
      {
        find: "@jarv1s/module-registry",
        replacement: fileURLToPath(
          new URL("./packages/module-registry/src/index.ts", import.meta.url)
        )
      },
      {
        // Subpath export; must precede the bare "@jarv1s/module-sdk" alias.
        find: "@jarv1s/module-sdk/core-version",
        replacement: fileURLToPath(
          new URL("./packages/module-sdk/src/core-version.ts", import.meta.url)
        )
      },
      {
        // Subpath export (#1110 fix in 34457186); must precede the bare "@jarv1s/module-sdk"
        // alias below, same pairing requirement as core-version above.
        find: "@jarv1s/module-sdk/ai-capabilities",
        replacement: fileURLToPath(
          new URL("./packages/module-sdk/src/ai-capabilities.ts", import.meta.url)
        )
      },
      {
        // Subpath export (#1110 VF regression fix); must precede the bare "@jarv1s/module-sdk"
        // alias below, same pairing requirement as core-version/ai-capabilities above.
        find: "@jarv1s/module-sdk/errors",
        replacement: fileURLToPath(new URL("./packages/module-sdk/src/errors.ts", import.meta.url))
      },
      {
        find: "@jarv1s/module-sdk",
        replacement: fileURLToPath(new URL("./packages/module-sdk/src/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/module-web-sdk",
        replacement: fileURLToPath(
          new URL("./packages/module-web-sdk/src/index.ts", import.meta.url)
        )
      },
      {
        // `apps/web/src/app-route-metadata.ts` imports the Vite-generated
        // `virtual:jarvis-module-web` module (#799); this file has many transitive consumers
        // (page-context, command-palette-model, section-tour-model, today-page, ...), so alias it
        // globally to a test fixture instead of mocking it per-test-file.
        find: "virtual:jarvis-module-web",
        replacement: fileURLToPath(
          new URL("./tests/fixtures/virtual-jarvis-module-web.ts", import.meta.url)
        )
      },
      {
        find: "@jarv1s/notes",
        replacement: fileURLToPath(new URL("./packages/notes/src/index.ts", import.meta.url))
      },
      {
        // #1025: root-level tests/uat/seed/chunks/news.ts needs NewsPrefsRepository; this
        // alias was missing entirely (every other module package has one).
        find: "@jarv1s/news",
        replacement: fileURLToPath(new URL("./packages/news/src/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/proactive-monitoring",
        replacement: fileURLToPath(
          new URL("./packages/proactive-monitoring/src/index.ts", import.meta.url)
        )
      },
      {
        find: "@jarv1s/notifications",
        replacement: fileURLToPath(
          new URL("./packages/notifications/src/index.ts", import.meta.url)
        )
      },
      {
        find: "@jarv1s/priority",
        replacement: fileURLToPath(new URL("./packages/priority/src/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/settings",
        replacement: fileURLToPath(new URL("./packages/settings/src/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/settings-ui",
        replacement: fileURLToPath(new URL("./packages/settings-ui/src/index.tsx", import.meta.url))
      },
      {
        find: "@jarv1s/settings-ui/vite",
        replacement: fileURLToPath(new URL("./packages/settings-ui/src/vite.ts", import.meta.url))
      },
      {
        find: "@jarv1s/shared",
        replacement: fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/sports",
        replacement: fileURLToPath(new URL("./packages/sports/src/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/source-behaviors",
        replacement: fileURLToPath(
          new URL("./packages/source-behaviors/src/index.ts", import.meta.url)
        )
      },
      {
        find: "@jarv1s/tasks",
        replacement: fileURLToPath(new URL("./packages/tasks/src/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/usefulness-feedback",
        replacement: fileURLToPath(
          new URL("./packages/usefulness-feedback/src/index.ts", import.meta.url)
        )
      },
      {
        find: "@jarv1s/web-research",
        replacement: fileURLToPath(new URL("./packages/web-research/src/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/memory",
        replacement: fileURLToPath(new URL("./packages/memory/src/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/vault",
        replacement: fileURLToPath(new URL("./packages/vault/src/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/structured-state",
        replacement: fileURLToPath(
          new URL("./packages/structured-state/src/index.ts", import.meta.url)
        )
      },
      {
        find: "@jarv1s/wellness",
        replacement: fileURLToPath(new URL("./packages/wellness/src/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/people",
        replacement: fileURLToPath(new URL("./packages/people/src/index.ts", import.meta.url))
      }
    ]
  },
  test: {
    include: [
      "spikes/**/*.test.ts",
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
      "packages/people/src/__tests__/**/*.test.ts"
    ],
    setupFiles: ["tests/setup-env.ts"],
    hookTimeout: 30_000,
    testTimeout: 30_000,
    pool: "forks",
    fileParallelism: false
  }
});
