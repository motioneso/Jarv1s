-- Runs as the superuser (postgres) before any migrations.
-- Installs pgvector so the vector type and operators are available to all roles.
CREATE EXTENSION IF NOT EXISTS vector;
