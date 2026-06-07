import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@jarv1s/ai",
        replacement: fileURLToPath(new URL("./packages/ai/src/index.ts", import.meta.url))
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
        find: "@jarv1s/chat",
        replacement: fileURLToPath(new URL("./packages/chat/src/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/db/probes",
        replacement: fileURLToPath(new URL("./packages/db/src/probes/index.ts", import.meta.url))
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
        find: "@jarv1s/notifications",
        replacement: fileURLToPath(
          new URL("./packages/notifications/src/index.ts", import.meta.url)
        )
      },
      {
        find: "@jarv1s/shared",
        replacement: fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/tasks",
        replacement: fileURLToPath(new URL("./packages/tasks/src/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/memory",
        replacement: fileURLToPath(new URL("./packages/memory/src/index.ts", import.meta.url))
      },
      {
        find: "@jarv1s/vault",
        replacement: fileURLToPath(new URL("./packages/vault/src/index.ts", import.meta.url))
      }
    ]
  },
  test: {
    include: ["spikes/**/*.test.ts", "tests/**/*.test.ts"],
    hookTimeout: 30_000,
    testTimeout: 30_000,
    pool: "forks",
    fileParallelism: false
  }
});
