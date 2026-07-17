import { spawn } from "node:child_process";
import { provisionForUat } from "../../../../../tests/uat/provisioner.js";

const scriptPath = process.argv[2] ?? "artifacts/webwright/pr-1117-6ca14fca-final/final_runs/run_1/final_script.py";
const level = (process.argv[3] ?? "bare") as "bare" | "solo-admin" | "admin+data" | "multi-user";

const run = (baseURL: string) => new Promise<number>((resolve, reject) => {
  const child = spawn("python3", [scriptPath], {
    stdio: "inherit",
    env: { ...process.env, JARVIS_UAT_BASE_URL: baseURL }
  });
  child.on("error", reject);
  child.on("exit", (code) => resolve(code ?? 1));
});

const { baseURL, teardown } = await provisionForUat(level);
try {
  const code = await run(baseURL);
  process.exitCode = code;
} finally {
  await teardown();
}
