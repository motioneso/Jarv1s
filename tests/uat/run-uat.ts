import { spawn } from "node:child_process";
import { provisionForUat } from "./provisioner.js";

async function main(): Promise<void> {
  const { baseURL, projectName, teardown } = await provisionForUat("admin+data", {
    excludeChunks: ["job-search"]
  });

  let exitCode = 1;
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
        ["playwright", "test", "--config=tests/uat/playwright.uat.config.ts"],
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
