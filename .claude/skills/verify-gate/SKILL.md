---
name: verify-gate
description: The only safe way to run the local gate — `pnpm verify:foundation` or any DB-touching test or migrate command — in this repo. Fresh exported gate database, unpiped exit codes, staggered runs. Use BEFORE running verify:foundation, test:integration, test:uat-seed, or db:migrate.
---

# Running the gate

`pnpm verify:foundation` is the full local gate (`package.json` lists what it chains). It is not
safe to run bare. Three ways it lies, each behind a real incident.

## 1. It runs against whatever database it finds — scope it yourself

An unscoped run in July 2026 hit the live dev database and took chat down for 90 minutes. Create a
fresh gate database and export it before the run:

```bash
GATEDB=jarvis_gate_<slug>
docker exec jarv1s-postgres psql -U postgres -c "DROP DATABASE IF EXISTS $GATEDB;"
docker exec jarv1s-postgres psql -U postgres -c "CREATE DATABASE $GATEDB;"
export JARVIS_PGDATABASE=$GATEDB
```

- `export`, never inline. `JARVIS_PGDATABASE=x pnpm …` does not survive backgrounding — the
  variable drops and the run lands on the live DB with no signal.
- DROP + CREATE every run. A reused gate DB carries prior migration state and greens for the
  wrong reason.
- DROP the gate DB when done — stale `*_gate_*` databases accumulate until someone cleans up.
- Stagger with other sessions: concurrent gate runs crash the shared dev Postgres. Check
  `herdr pane list` before starting one.

## 2. Never pipe a gate command

A pipeline returns the *filter's* exit code, so `| tail` / `| grep` / `| tee` reads red as green.
`.claude/hooks/check-gate-pipe.sh` blocks the obvious forms, but write it safely anyway: log to a
file with a sentinel, and read the result from the file.

```bash
( pnpm verify:foundation > /tmp/vf.log 2>&1; echo "### FINAL rc=$?" >> /tmp/vf.log ) &
# when it finishes:
grep '### FINAL' /tmp/vf.log
```

Never trust `echo $?` after a backgrounded command either — it reports the backgrounding, not the
gate.

## 3. Green local is not green CI

The gate does **not** include `test:e2e`. CI runs the browser suite as a separate step, so a green
local gate can sit on a red CI job. Say which one you verified.
