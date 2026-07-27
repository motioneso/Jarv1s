// tests/uat/fixtures/job-search-fixture-server.ts
//
// #1306 Task 22: the deterministic origin the UAT run points the job-search module's crawl at,
// via the host-side createFetch bypass in apps/worker/src/external-module-job-handler.ts. The
// test must not touch LinkedIn or freehire.me — a live portal makes this fail on someone else's
// Cloudflare rule at 3am (see the Task 22 handoff doc's "fetch ruling"). This server answers with
// Task 11's saved captures (tests/fixtures/job-search/*) instead.
//
// Binds on all interfaces (default host "0.0.0.0"), not just loopback: the crawl runs inside the
// UAT stack's `jarv1s` worker container, where `127.0.0.1` means the container itself, not this
// process. The provisioner (provisioner.ts) is responsible for computing a base URL the container
// can actually resolve — typically the Docker bridge gateway address of UAT_DOCKER_SUBNET — and
// publishing it as JARVIS_E2E_MODULE_FETCH_BASE. This module has no opinion about that; it only
// binds wide enough to be reachable once the provisioner points at it.
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// tests/uat/fixtures -> tests/fixtures/job-search
const FIXTURE_DIR = join(HERE, "..", "..", "fixtures", "job-search");

interface FixtureRoute {
  readonly contentType: string;
  readonly body: Buffer;
}

/**
 * Path-keyed static route table. Matched on `pathname` only — `createE2eFixtureFetch` rewrites
 * the full `pathname + search` from the real target URL onto this server's origin, and the real
 * adapters vary their query string per page/criteria (see freehire.ts's `buildUrl` and
 * linkedin.ts's), so a query-sensitive match would 404 on every request but the first.
 */
function buildRoutes(): ReadonlyMap<string, FixtureRoute> {
  return new Map<string, FixtureRoute>([
    // Matches freehire.ts's BASE_URL ("https://freehire.me/__data.json") pathname exactly.
    [
      "/__data.json",
      {
        contentType: "application/json; charset=utf-8",
        body: readFileSync(join(FIXTURE_DIR, "freehire-data.json"))
      }
    ],
    // Matches linkedin.ts's BASE_URL
    // ("https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search") pathname exactly.
    [
      "/jobs-guest/jobs/api/seeMoreJobPostings/search",
      {
        contentType: "text/html; charset=utf-8",
        body: readFileSync(join(FIXTURE_DIR, "linkedin-guest.html"))
      }
    ]
  ]);
}

export interface JobSearchFixtureServer {
  readonly port: number;
  /** Base URL as seen from THIS host/process — callers that need the container's route in
   *  (a Docker bridge gateway address, say) must build that URL themselves from `port`. */
  readonly baseUrl: string;
  readonly stop: () => Promise<void>;
}

/**
 * Starts the fixture origin and resolves once it is actually listening. Binds an OS-assigned
 * ephemeral port (`listen(0, host)`) rather than reusing provisioner.ts's bind-probed
 * UAT_PORT_RANGE — nothing else needs to guess this port ahead of time, it only has to be known
 * once, right here, before it is written into the stack's env (Task 22 step 4).
 *
 * Any request outside the two known paths gets a 404 with a body naming the path, not a silent
 * empty 200 — a typo'd adapter path should fail loudly here, not read back as "zero postings
 * found."
 */
export async function startJobSearchFixtureServer(
  options: { readonly host?: string } = {}
): Promise<JobSearchFixtureServer> {
  const host = options.host ?? "0.0.0.0";
  const routes = buildRoutes();

  const server: Server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://fixture.invalid").pathname;
    const route = routes.get(pathname);
    if (!route) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end(`job-search fixture server: no route for ${pathname}`);
      return;
    }
    res.writeHead(200, { "content-type": route.contentType });
    res.end(route.body);
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => resolvePromise());
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("job-search fixture server: expected an AddressInfo after listen()");
  }
  const { port } = address;

  return {
    port,
    baseUrl: `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`,
    stop: () =>
      new Promise<void>((resolvePromise, reject) => {
        server.close((error) => (error ? reject(error) : resolvePromise()));
      })
  };
}
