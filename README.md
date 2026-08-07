# Moss

A self-hosted AI home base. Chat with an assistant that actually knows your notes, calendar, email, tasks and goals — because all of it lives on your own machine, in your own database.

Moss is in active alpha. Expect rough edges.

## What it does

Moss is a chat interface with a set of modules behind it. The assistant can read from and write to any module you have enabled, so "what's on for tomorrow, and did I ever reply to Sarah?" is one question, not four apps.

**Your stuff**

- **Notes** — point Moss at a Markdown or Obsidian folder and it indexes and searches it
- **Tasks**, **Lists**, **Goals**, **Commitments** — things to do and things you said you'd do
- **People** — who you know and what you last talked about
- **Calendar** and **Email** — read-only context from connected accounts

**The day**

- **Briefings** — a morning summary built from everything above
- **Weather**, **News**, **Sports** — the ambient stuff, filtered to what you follow
- **Notifications** and **Proactive monitoring** — Moss tells you when something changed instead of waiting to be asked
- **Wellness** — check-ins and trends

**Under the hood**

- **Memory** — the assistant remembers across conversations
- **Web** — fetch and read pages during a conversation
- **Connectors** — link external accounts
- **Settings** — configure all of it from the UI

## Bring your own AI

Moss has no built-in model and no bundled API key. You configure a provider in Settings and every feature routes to it. Nothing in the codebase hardcodes a provider or a model name, so switching is a settings change, not a migration.

## Modules

Every feature above is a module with a manifest — its own database tables, background jobs, permissions, UI, and tools the assistant can call. Modules talk to each other only through declared APIs, so you can enable the ones you want and ignore the rest. The same interface is how you'd add your own.

## Install

One Postgres container and one Moss container. Copy this into `compose.yml`, replace the two placeholder secrets, then start it.

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg17
    restart: unless-stopped
    environment:
      POSTGRES_DB: jarv1s
      POSTGRES_USER: jarv1s
      # Change this. Keep it in sync with JARVIS_DB_PASSWORD below.
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

      # Change this. Use a long random value.
      JARVIS_SECRET: replace-this-jarv1s-secret

      JARVIS_DB_HOST: postgres
      JARVIS_DB_NAME: jarv1s
      JARVIS_DB_USER: jarv1s
      # Must match POSTGRES_PASSWORD above.
      JARVIS_DB_PASSWORD: replace-this-postgres-password

      # Fixed in-container path for notes. Edit the volume mount below, not this.
      JARVIS_NOTES_ROOTS: /data/external-notes
    volumes:
      - jarv1s-data:/data

      # Optional: mount your notes folder read-only.
      # - /Users/you/Obsidian:/data/external-notes:ro
      # - /srv/obsidian:/data/external-notes:ro

volumes:
  jarv1s-postgres:
  jarv1s-data:
```

```sh
docker compose pull
docker compose up -d
```

Open `http://localhost:1533`. To upgrade later, run the same two commands.

The Moss container runs the web UI, API, background worker, database migrations, notes indexing, and the provider CLI runtime. Postgres stays in its own container because database lifecycle and durable storage belong in the official image.

Moss refuses to start if the placeholder secrets are left unchanged.

## Notes

Mounting a notes folder is optional. If you mount one at `/data/external-notes`, Moss indexes the Markdown in it and the assistant can search it. Mount it read-only unless you want Moss writing back.

## Backups

Two volumes hold everything: `jarv1s-postgres` (the database) and `jarv1s-data` (app state, provider CLI auth, caches, local files).

```sh
docker compose down
docker run --rm -v jarv1s-postgres:/data -v "$PWD":/backup alpine \
  tar czf /backup/jarv1s-postgres.tar.gz -C /data .
docker run --rm -v jarv1s-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/jarv1s-data.tar.gz -C /data .
docker compose up -d
```

## Your data stays yours

Everything runs on your hardware. Data is private by default and owner-only unless you explicitly share it. Credentials are encrypted at rest and never reach the frontend, the logs, or an AI prompt.

## Development

Setup lives in [CLAUDE.md](CLAUDE.md) and [docs/operations/dev-environment.md](docs/operations/dev-environment.md).

```sh
pnpm install
pnpm db:up
pnpm verify:foundation
```
