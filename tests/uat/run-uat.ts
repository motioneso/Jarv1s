import { spawn } from "node:child_process";
import { provisionForUat } from "./provisioner.js";

async function main(): Promise<void> {
  const specFilters = process.argv.slice(2);
  // #1027/#1047/#1000: job-search-install needs the module absent, but that seed override must
  // follow the selected spec instead of leaking into every future filtered UAT invocation.
  const runsJobSearchInstall =
    specFilters.length === 0 || specFilters.some((filter) => filter.includes("job-search-install"));
  const { baseURL, projectName, teardown } = await provisionForUat("admin+data", {
    excludeChunks: runsJobSearchInstall ? ["job-search"] : []
  });

  let exitCode: number;
  const onSignal = () => {
    void teardown().finally(() => process.exit(1));
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    console.log(`[uat] running Playwright against ${baseURL} (project ${projectName})`);
    exitCode = await new Promise<number>((resolvePromise) => {
      const child = spawn(
        "npx",
        [
          "playwright",
          "test",
          "--config=tests/uat/playwright.uat.config.ts",
          // #1027/#1047: coordinate resolves one matching spec; forwarding it is what makes the
          // gate execute that spec instead of silently running an unrelated/default selection.
          ...specFilters
        ],
        {
          stdio: "inherit",
          env: {
            ...process.env,
            JARVIS_UAT_BASE_URL: baseURL,
            JARVIS_UAT_PROJECT_NAME: projectName
          }
        }
      );
      child.on("exit", (code) => resolvePromise(code ?? 1));
    });
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await teardown();
  }

  process.exit(exitCode);
}

await main();
