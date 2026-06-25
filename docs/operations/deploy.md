# Deploy Guide

Jarv1s should deploy like a small self-hosted appliance: one Postgres container for durable data, and one Jarv1s container for everything Jarv1s owns.

The operator-facing path is a commented Docker Compose file. No installer script, host CLI preflight, or UID/GID prompt should be required.

## Target Compose

Copy this into `compose.yml`, change the placeholder values, optionally mount your notes folder, then run `docker compose up -d`.

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg17
    restart: unless-stopped
    environment:
      POSTGRES_DB: jarv1s
      POSTGRES_USER: jarv1s
      # Change this before first start. Keep it in sync with JARVIS_DB_PASSWORD below.
      POSTGRES_PASSWORD: replace-this-postgres-password
    volumes:
      - jarv1s-postgres:/var/lib/postgresql/data

  jarv1s:
    image: ghcr.io/motioneso/jarv1s:stable
    restart: unless-stopped
    depends_on:
      - postgres
    ports:
      - "1533:3000"
    environment:
      JARVIS_BASE_URL: http://localhost:1533

      # Change this before first start. Use a long random value.
      JARVIS_SECRET: replace-this-jarv1s-secret

      JARVIS_DB_HOST: postgres
      JARVIS_DB_NAME: jarv1s
      JARVIS_DB_USER: jarv1s
      # Must match POSTGRES_PASSWORD above.
      JARVIS_DB_PASSWORD: replace-this-postgres-password

      # Jarv1s uses this fixed in-container path for notes. Edit only the volume mount below.
      JARVIS_NOTES_ROOTS: /data/external-notes
    volumes:
      - jarv1s-data:/data

      # Optional: uncomment and replace the left side with your Markdown/Obsidian folder.
      # Use an absolute host path. Examples:
      # - macOS: /Users/you/Obsidian:/data/external-notes:ro
      # - Linux: /srv/obsidian:/data/external-notes:ro
      # - /Users/you/Obsidian:/data/external-notes:ro

volumes:
  jarv1s-postgres:
  jarv1s-data:
```

Open `http://localhost:1533`.

## Upgrade

```sh
docker compose pull
docker compose up -d
```

The default image channel should be `ghcr.io/motioneso/jarv1s:stable`. Version tags remain useful for rollback and debugging, but users should not have to edit a tag for routine upgrades.

## Production Compose

The committed production artifact is `infra/docker-compose.prod.yml`. It keeps Postgres separate and runs API, web serving, worker, migrations, and provider CLIs inside the `jarv1s` container.

## Secrets

Jarv1s should not generate secrets for the operator. The compose file carries explicit placeholders. If placeholder values are left unchanged, Jarv1s should fail boot with a clear error.

Required user-edited values:

- `POSTGRES_PASSWORD`
- `JARVIS_SECRET`
- `JARVIS_BASE_URL` when not using localhost
- optional notes bind mount

UID/GID should not be part of the happy path. The Jarv1s image should handle ownership of its managed `/data` volume internally. If writable host bind mounts later need custom ownership, document that under advanced permissions.

## Notes Mount

Notes are optional. If a Markdown or Obsidian folder is mounted at `/data/external-notes`, Jarv1s can index it and expose note excerpts to chat through the notes search tool.

Use a read-only mount by default:

```yaml
- /Users/you/Obsidian:/data/external-notes:ro
```

Only use `:rw` if a future write-back feature explicitly requires it.

## Backups

Back up both volumes:

- `jarv1s-postgres`: database
- `jarv1s-data`: app state, provider CLI auth, caches, and local files

Stop the stack before raw volume snapshots:

```sh
docker compose down
docker run --rm -v jarv1s-postgres:/data -v "$PWD":/backup alpine \
  tar czf /backup/jarv1s-postgres.tar.gz -C /data .
docker run --rm -v jarv1s-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/jarv1s-data.tar.gz -C /data .
docker compose up -d
```

For logical database dump/restore procedures, see [backup.md](./backup.md).

## Repository Compose

For a checkout-based deploy, generate `infra/env.production.local` with the setup service, then start the single-container production stack:

```sh
JARVIS_IMAGE_TAG=v0.1.0 POSTGRES_PASSWORD=setup JARVIS_CLI_RUNNER_RPC_SECRET=setup \
  docker compose -p jarv1s-prod -f infra/docker-compose.prod.yml --profile setup run --rm setup

docker compose -p jarv1s-prod \
  -f infra/docker-compose.prod.yml \
  --env-file infra/env.production.local \
  up -d
```

If notes are enabled, set `JARVIS_NOTES_VAULT_HOST_PATH` and include the notes override on both commands:

```sh
JARVIS_NOTES_VAULT_HOST_PATH=/Users/you/Obsidian \
JARVIS_IMAGE_TAG=v0.1.0 POSTGRES_PASSWORD=setup JARVIS_CLI_RUNNER_RPC_SECRET=setup \
  docker compose -p jarv1s-prod \
  -f infra/docker-compose.prod.yml \
  -f infra/docker-compose.notes.yml \
  --profile setup run --rm setup

docker compose -p jarv1s-prod \
  -f infra/docker-compose.prod.yml \
  -f infra/docker-compose.notes.yml \
  --env-file infra/env.production.local \
  up -d
```
