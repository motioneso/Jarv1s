# fix76: Restart Policy + Healthcheck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `restart: unless-stopped` policies and an API healthcheck to `infra/docker-compose.yml` so crash-exit → self-heal instead of permanent outage, and fix the `pnpm smoke:compose` startup race that causes flaky CI.

**Architecture:** The compose `api` service already exposes `/health` (returns `{ ok: true }`) and `/health/ready` (checks DB + pgboss). We add a Docker `HEALTHCHECK` on `/health` (liveness — process crash detection) with a generous `start_period` to cover the `pnpm install --frozen-lockfile` container startup time. `restart: unless-stopped` goes on `api`, `worker`, and `web`. The `web` `depends_on` is upgraded to `service_healthy` so it waits for the api healthcheck before starting. The smoke script's `up -d api web worker` step gains `--wait` so Docker itself blocks until the api healthcheck passes — this eliminates the existing `waitForHealth` 60-second timeout race in CI.

**Smoke flake root cause (related: issue #67):** The `Timed out waiting for http://localhost:3099/health` CI flake occurs because `pnpm install --frozen-lockfile` inside the container (using a container-private temp store at `/tmp/pnpm-store`) routinely exceeds the 60-second `waitForHealth` deadline. The fix here — adding `--wait` to the `up` command, gated on the api healthcheck — addresses the race; a deeper fix (pre-built images or a persistent pnpm store volume) belongs in issue #67.

**Tech Stack:** Docker Compose v2, Node.js 24 built-in `fetch`, Vitest (existing integration test suite)

---

### Task 1: Add restart policies + API healthcheck to docker-compose.yml

**Files:**

- Modify: `infra/docker-compose.yml` (lines 62–108)

The `api` service needs `restart: unless-stopped` and a `healthcheck` block. The `worker` and `web` services need `restart: unless-stopped`. The `web` `depends_on` should be upgraded to wait for `api`'s healthcheck.

Use `node` (always present in the container) to probe `/health`. The healthcheck command is:

```
node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

A `start_period: 120s` gives the container time to run `corepack enable && pnpm install --frozen-lockfile` before Docker starts counting healthcheck retries. After `start_period`, five retries at 10-second intervals (50 seconds of grace) before marking unhealthy.

- [ ] **Step 1: Add restart + healthcheck to api service**

In `infra/docker-compose.yml`, update the `api` service block (after `ports:`, before `depends_on:`):

```yaml
  api:
    image: node:24-bookworm-slim
    working_dir: /workspace
    volumes: *workspace-volumes
    environment:
      CI: "true"
      PORT: "3000"
      HOST: 0.0.0.0
      JARVIS_APP_DATABASE_URL: postgres://jarvis_app_runtime:app_password@postgres:5432/jarv1s
      JARVIS_AUTH_DATABASE_URL: postgres://jarvis_auth_runtime:auth_password@postgres:5432/jarv1s
    command: sh -c "corepack enable && pnpm install --frozen-lockfile --store-dir /tmp/pnpm-store && pnpm start:api"
    restart: unless-stopped
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
        ]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 120s
    ports:
      - "${JARVIS_API_PORT:-3000}:3000"
    depends_on:
      migrate:
        condition: service_completed_successfully
    networks:
      - jarv1s
```

- [ ] **Step 2: Add restart + service_healthy depends_on to web service**

Update the `web` service block:

```yaml
  web:
    image: node:24-bookworm-slim
    working_dir: /workspace
    volumes: *workspace-volumes
    environment:
      CI: "true"
      JARVIS_API_PROXY_TARGET: http://api:3000
    command: sh -c "corepack enable && pnpm install --frozen-lockfile --store-dir /tmp/pnpm-store && pnpm dev:web"
    restart: unless-stopped
    ports:
      - "${JARVIS_WEB_PORT:-5173}:5173"
    depends_on:
      api:
        condition: service_healthy
    networks:
      - jarv1s
```

- [ ] **Step 3: Add restart to worker service**

Update the `worker` service block:

```yaml
  worker:
    image: node:24-bookworm-slim
    working_dir: /workspace
    volumes: *workspace-volumes
    environment:
      CI: "true"
      JARVIS_WORKER_DATABASE_URL: postgres://jarvis_worker_runtime:worker_password@postgres:5432/jarv1s
    command: sh -c "corepack enable && pnpm install --frozen-lockfile --store-dir /tmp/pnpm-store && pnpm start:worker"
    restart: unless-stopped
    depends_on:
      migrate:
        condition: service_completed_successfully
    networks:
      - jarv1s
```

- [ ] **Step 4: Validate the compose config**

```bash
docker compose -f infra/docker-compose.yml config --quiet
```

Expected: exits 0 with no output (or deprecation warnings only, no errors).

- [ ] **Step 5: Commit**

```bash
git add infra/docker-compose.yml
git commit -m "$(cat <<'EOF'
fix(infra): add restart policies and API healthcheck to docker-compose

Crash-exit handlers call process.exit(1) as a 'restart me' signal, but
the compose deployment had no restart policy — a crash caused a permanent
outage until manual intervention.

- Add restart: unless-stopped to api, worker, web
- Add HEALTHCHECK to api on /health (node fetch, start_period: 120s)
- Upgrade web depends_on to service_healthy so it waits for a live api

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Fix smoke-compose startup race — add --wait to compose up

**Files:**

- Modify: `scripts/smoke-compose.ts` (the `createComposeSmokePlan` function, `commands` array)
- Modify: `tests/integration/release-hardening.test.ts` (add assertion for `--wait`)

The smoke script runs `docker compose up -d api web worker` and then polls `/health` for up to 60 seconds. In CI, `pnpm install --frozen-lockfile` inside the container can exceed 60 seconds, causing a flaky timeout (related: issue #67). After Task 1, the `api` service has a Docker healthcheck. Adding `--wait` to the `up` command tells Docker Compose to block until the api's healthcheck passes. The `waitForHealth` in the script then succeeds on the first poll.

- [ ] **Step 1: Write the failing test**

In `tests/integration/release-hardening.test.ts`, inside the existing `"builds backup, restore, and Docker Compose smoke plans without exposing database passwords"` test, add an assertion after the existing composePlan assertions:

```typescript
expect(composePlan.commands.some((c) => c.args.includes("--wait"))).toBe(true);
```

The full updated assertion block (replace the composePlan assertions in the existing test):

```typescript
expect(composePlan.healthUrl).toBe("http://localhost:3900/health");
expect(JSON.stringify(composePlan.commands)).toContain("infra/docker-compose.yml");
expect(JSON.stringify(composePlan.commands)).not.toContain("postgres://");
expect(composePlan.commands.some((c) => c.args.includes("--wait"))).toBe(true);
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
JARVIS_PGDATABASE=jarvis_fix76 pnpm test:release-hardening 2>&1 | grep -A 5 "builds backup"
```

Expected: test fails with something like `Expected: true / Received: false`

- [ ] **Step 3: Add --wait to the compose up command in smoke-compose.ts**

In `scripts/smoke-compose.ts`, update `createComposeSmokePlan` — find the `up -d api web worker` command object and add `"--wait"` after `"worker"`:

Current:

```typescript
{
  command: "docker",
  args: [...composeArgs, "up", "-d", "api", "web", "worker"],
  description: "Start API, web, and worker services"
}
```

Updated:

```typescript
{
  command: "docker",
  args: [...composeArgs, "up", "-d", "api", "web", "worker", "--wait"],
  description: "Start API, web, and worker services"
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
JARVIS_PGDATABASE=jarvis_fix76 pnpm test:release-hardening 2>&1 | grep -A 5 "builds backup"
```

Expected: test passes (PASS / ✓)

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-compose.ts tests/integration/release-hardening.test.ts
git commit -m "$(cat <<'EOF'
fix(infra): use --wait in compose up to eliminate smoke health-poll race

Root cause of flaky 'Timed out waiting for /health' (see issue #67):
pnpm install inside the container can exceed the 60-second waitForHealth
deadline. Now that the api service has a Docker HEALTHCHECK, passing
--wait to compose up blocks until the healthcheck passes before the
script polls /health — eliminating the race. A deeper fix (pre-built
images or persistent pnpm store volume) is tracked in issue #67.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Update ops docs

**Files:**

- Modify: `docs/operations/release-hardening.md` (Docker Compose Smoke section)

- [ ] **Step 1: Update Docker Compose Smoke section in release-hardening.md**

In `docs/operations/release-hardening.md`, find the "Docker Compose Smoke" section. After the sentence "It then polls `http://localhost:3000/health`.", add:

```markdown
The `api`, `worker`, and `web` services are configured with `restart: unless-stopped`, so a
crash-exit self-heals without manual intervention. The `api` service also has a Docker
`HEALTHCHECK` on `/health`; the smoke script passes `--wait` to `docker compose up` so Docker
blocks until that healthcheck passes before polling begins, making the smoke check reliable even
when container startup (including `pnpm install`) is slow. (The underlying cause — no persistent
pnpm store across container restarts — is tracked in issue #67.)
```

- [ ] **Step 2: Run pre-push trio**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
```

Expected: all pass. If `format:check` fails on the markdown file, run `pnpm format` then re-stage only the docs file.

- [ ] **Step 3: Commit**

```bash
git add docs/operations/release-hardening.md
git commit -m "$(cat <<'EOF'
docs(ops): document restart policies and healthcheck in release-hardening guide

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Final gate

Before pushing:

```bash
pnpm format:check && pnpm lint && pnpm typecheck
git fetch origin main && git rebase origin/main
```

The full integration test suite and smoke test are run by the coordinator's QA step post-PR — you do not need to run `pnpm smoke:compose` locally (it requires Docker and several minutes). Run `JARVIS_PGDATABASE=jarvis_fix76 pnpm test:release-hardening` to confirm the unit-level assertions pass.
