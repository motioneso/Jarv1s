# Codename Jarvis

Codename Jarvis is a self-hosted AI home base for chat, notes, tasks, briefings, calendar context, and personal automations.

The product is under active alpha development. The long-term install goal is a simple Docker Compose file: one Postgres container for durable data, and one Codename Jarvis container for the app, web UI, worker, migrations, and provider CLI runtime.

## Docker Compose Template

This is the target user-facing deploy shape. Copy it into `compose.yml`, change the placeholder secrets, optionally mount your Markdown or Obsidian notes folder, then run Docker Compose.

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg17
    restart: unless-stopped
    environment:
      POSTGRES_DB: Codename Jarvis
      POSTGRES_USER: Codename Jarvis
      # Change this before first start. Keep it in sync with JARVIS_DB_PASSWORD below.
      POSTGRES_PASSWORD: replace-this-postgres-password
    volumes:
      - Codename Jarvis-postgres:/var/lib/postgresql/data

  Codename Jarvis:
    image: ghcr.io/motioneso/Codename Jarvis:stable
    restart: unless-stopped
    depends_on:
      - postgres
    ports:
      - "1533:3000"
    environment:
      JARVIS_BASE_URL: http://localhost:1533

      # Change this before first start. Use a long random value.
      JARVIS_SECRET: replace-this-Codename Jarvis-secret

      JARVIS_DB_HOST: postgres
      JARVIS_DB_NAME: Codename Jarvis
      JARVIS_DB_USER: Codename Jarvis
      # Must match POSTGRES_PASSWORD above.
      JARVIS_DB_PASSWORD: replace-this-postgres-password

      # Codename Jarvis uses this fixed in-container path for notes. Edit only the volume mount below.
      JARVIS_NOTES_ROOTS: /data/external-notes
    volumes:
      - Codename Jarvis-data:/data

      # Optional: uncomment and replace the left side with your Markdown/Obsidian folder.
      # Use an absolute host path. Examples:
      # - macOS: /Users/you/Obsidian:/data/external-notes:ro
      # - Linux: /srv/obsidian:/data/external-notes:ro
      # - /Users/you/Obsidian:/data/external-notes:ro

volumes:
  Codename Jarvis-postgres:
  Codename Jarvis-data:
```

Start or upgrade:

```sh
docker compose pull
docker compose up -d
```

Open `http://localhost:1533`.

## What Runs

The target deployment keeps Postgres separate because database lifecycle and durable storage are safest in the official Postgres/pgvector container. Everything Codename Jarvis owns should live in the Codename Jarvis container:

- web UI
- API
- background worker
- database migrations
- provider CLI runtime
- notes indexing

The app should fail loudly if placeholder secrets are left unchanged.

## Notes

Mounting notes is optional. If you mount a folder at `/data/external-notes`, Codename Jarvis can ingest Markdown files and expose them to chat through the notes search tool. The default mount should be read-only unless a future write-back feature is enabled.

## Backups

Back up these Docker volumes:

- `Codename Jarvis-postgres`: database
- `Codename Jarvis-data`: app state, provider CLI auth, caches, and local files

For a simple volume backup, stop the stack first:

```sh
docker compose down
docker run --rm -v Codename Jarvis-postgres:/data -v "$PWD":/backup alpine \
  tar czf /backup/Codename Jarvis-postgres.tar.gz -C /data .
docker run --rm -v Codename Jarvis-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/Codename Jarvis-data.tar.gz -C /data .
docker compose up -d
```

## Development

Developer setup lives in [CLAUDE.md](CLAUDE.md) and [docs/operations/dev-environment.md](docs/operations/dev-environment.md).

Common local checks:

```sh
pnpm install
pnpm db:up
pnpm verify:foundation
```
