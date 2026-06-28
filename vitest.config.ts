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
        find: "@jarv1s/chat",
        replacement: fileURLToPath(new URL("./packages/chat/src/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/db/probes",
        replacement: fileURLToPath(new URL("./packages/db/src/probes/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/commitments/prefilter",
        replacement: fileURLToPath(new URL("./packages/commitments/src/prefilter.ts", import.meta.url))
      },
      {
        find: "@jarv1s/commitments/signature",
        replacement: fileURLToPath(new URL("./packages/commitments/src/signature.ts", import.meta.url))
      },
      {
        find: "@jarv1s/commitments",
        replacement: fileURLToPath(new URL("./packages/commitments/src/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/connectors",
        replacement: fileURLToPath(new URL("./packages/connectors/src/index.ts", import.meta.url))
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
        find: "@jarv1s/module-registry",
        replacement: fileURLToPath(
          new URL("./packages/module-registry/src/index.ts", import.meta.url)
        )
      },
      {
        find: "@jarv1s/module-sdk",
        replacement: fileURLToPath(new URL("./packages/module-sdk/src/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/notes",
        replacement: fileURLToPath(new URL("./packages/notes/src/index.ts", import.meta.url))
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
      }
    ]
  },
  test: {
    include: ["spikes/**/*.test.ts", "tests/**/*.test.ts", "tests/**/*.test.tsx"],
    hookTimeout: 30_000,
    testTimeout: 30_000,
    pool: "forks",
    fileParallelism: false
  }
});
