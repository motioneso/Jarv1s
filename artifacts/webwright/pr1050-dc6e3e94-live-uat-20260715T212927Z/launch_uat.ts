import { writeFileSync } from "node:fs";

import { provisionForUat } from "../../../tests/uat/provisioner.ts";

const statePath = new URL("./uat-state.json", import.meta.url);
const exactHead = "dc6e3e949c861848d7800f0b45a976546001c2ad";

process.env.JARVIS_IMAGE_TAG = "uat-1050-dc6e3e94-live";

const provisioned = await provisionForUat("solo-admin");
writeFileSync(
  statePath,
  JSON.stringify(
    {
      baseURL: provisioned.baseURL,
      projectName: provisioned.projectName,
      exactHead
    },
    null,
    2
  )
);
console.log(`UAT_READY ${provisioned.baseURL} ${provisioned.projectName}`);

let stopping = false;
const keepAlive = setInterval(() => {}, 60_000);
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearInterval(keepAlive);
  await provisioned.teardown();
  process.exit(0);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
