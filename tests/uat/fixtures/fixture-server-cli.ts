// tests/uat/fixtures/fixture-server-cli.ts
//
// #1306 Task 22: container entrypoint for the job-search fixture origin. The UAT provisioner runs
// this as a plain `docker run -d` attached to the stack's Compose network, using the same image
// the stack itself runs (which already ships `tests/` and `node_modules/.bin/tsx` — that is how
// the `seed` and `module-install` ops services run repo TypeScript in-network).
//
// Why in-network rather than on the host: a host-side server is reachable from the `jarv1s`
// worker only through the Docker bridge gateway address, which ufw drops by default. See
// job-search-fixture-server.ts's header for the live failure that established this.
//
// The port is fixed rather than OS-assigned. It is private to the Compose network (nothing is
// published to the host), so there is no conflict to avoid, and a predictable number lets the
// provisioner write the base URL into the stack's env file BEFORE this container exists.
import {
  JOB_SEARCH_FIXTURE_CONTAINER_PORT,
  startJobSearchFixtureServer
} from "./job-search-fixture-server.js";

const server = await startJobSearchFixtureServer({ port: JOB_SEARCH_FIXTURE_CONTAINER_PORT });

// The provisioner polls `docker logs` for this exact line to know the origin is accepting
// connections — printed only after listen() has resolved, so it is a real readiness signal and
// not just "the process started".
console.log(`[job-search-fixture] listening on ${server.port}`);

// Stay alive until the provisioner removes the container. Without an explicit handler, SIGTERM
// from `docker rm -f` would kill the process without closing the server; closing it first means a
// clean exit code in the container's status, so a genuinely crashed fixture is distinguishable
// from a deliberately torn-down one.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void server.stop().then(() => process.exit(0));
  });
}
