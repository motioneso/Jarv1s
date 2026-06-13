# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Jarv1s static-web image (ghcr.io/motioneso/jarv1s-web) — deployable-stack §4.
# Build the Vite SPA bundle, then serve it from nginx with /api + /health proxy.
# Built from the repo root context (so the workspace + lockfile are available).
# ---------------------------------------------------------------------------

# ---- build: produce apps/web/dist -----------------------------------------
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.6.2 --activate
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build:web

# ---- runtime: nginx serving the static bundle -----------------------------
FROM nginx:1.27-bookworm AS runtime
COPY infra/nginx/jarv1s-web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
