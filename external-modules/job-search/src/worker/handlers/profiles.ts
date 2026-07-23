import { NS } from "../../domain/kv-port.js";
import type { WorkerPorts } from "../ports.js";
import type { ToolHandler } from "../wrap.js";

export const profilesListHandler =
  (ports: WorkerPorts): ToolHandler =>
  async () => {
    const profiles: Record<string, unknown>[] = [];
    for (const key of await ports.kv.list(NS.profiles)) {
      const profile = await ports.kv.get(NS.profiles, key);
      if (profile) profiles.push(profile);
    }
    return profiles.length > 0 ? { profiles } : { profiles, nextStep: "start a new search" };
  };
