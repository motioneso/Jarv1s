import { randomBytes } from "node:crypto";
import { createServer } from "node:net";

export interface UatRunId {
  readonly projectName: string;
  readonly suffix: string;
}

/**
 * #1024/#1000: mirrors scripts/test-integration.ts's `${pid}_${randomHex}` entropy suffix so a
 * local UAT run and a concurrent coordinator UAT run never collide on the same Compose project
 * name (spec §3.2) — Compose project names scope every container/volume/network it creates.
 */
export function generateUatRunId(): UatRunId {
  const suffix = `${process.pid}_${randomBytes(4).toString("hex")}`;
  return { projectName: `uat-${suffix}`, suffix };
}

// #1024/#1000: dev/prod default is 10.251.0.0/24 (infra/docker-compose.prod.yml), smoke reserves
// 10.253.0.0/24 (scripts/smoke-compose.ts:117) — UAT reserves its own /24 so a concurrent
// dev+smoke+UAT run never IP-collides on the Docker bridge (spec §3.4).
export const UAT_DOCKER_SUBNET = "10.254.0.0/24";

// #1024/#1000: prod's fixed host port is 1533 (JARVIS_WEB_PORT default). Rather than editing the
// prod-shaped compose file to support a Docker-assigned ephemeral port (spec §3.4 option 2), Phase
// 1 reserves a narrow high port range and bind-probes it (Task 2) — zero compose-file changes,
// same technique already used for JARVIS_DOCKER_SUBNET.
export const UAT_PORT_RANGE_START = 20000;
export const UAT_PORT_RANGE_SIZE = 100;

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.once("error", () => resolvePromise(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolvePromise(true));
    });
  });
}

/**
 * #1024/#1000: probes UAT_PORT_RANGE candidates in order and returns the first free one. A
 * `probe` override is accepted purely so unit tests can force a deterministic outcome without
 * relying on real OS port state; production callers omit it and get the real bind-probe.
 *
 * #1024 (Coordinator condition 1): this only proves a candidate was free at PROBE time — it
 * cannot close the TOCTOU race against `docker compose up` binding the port moments later in a
 * different process. That race is handled by main() (Task 6): on a real compose bind-conflict
 * exit, main() calls this function again with the remaining untried candidates rather than
 * looping in here. Keep this function a pure single-pass probe; don't add retry logic here.
 */
export async function findAvailablePort(
  candidates: readonly number[],
  probe: (port: number) => Promise<boolean> = isPortFree
): Promise<number> {
  for (const candidate of candidates) {
    if (await probe(candidate)) {
      return candidate;
    }
  }
  throw new Error(`no available port found among candidates: ${candidates.join(", ")}`);
}
