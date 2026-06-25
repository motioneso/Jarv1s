#!/bin/sh
# ===========================================================================
# Jarv1s publish-images.sh — multi-arch publish to GHCR.
#
# Builds + pushes linux/amd64,linux/arm64 images so an operator on any OS can
# `docker compose pull`. This is a
# MAINTAINER release tool (not operator-facing) — run from the repo root on a
# host with Docker buildx and a GHCR PAT.
#
# Usage:
#   ./scripts/publish-images.sh [TAG]      # TAG defaults to `git describe --tags`
#
# ONE-TIME PREREQS (do once per machine):
#   1. Create a buildx builder (the default driver can't do multi-arch + push):
#        docker buildx create --use --name jarv1s-builder
#   2. Log in to GHCR with a PAT that has `write:packages` (a classic PAT, or a
#      fine-grained PAT with the repo's package write scope):
#        echo "<PAT>" | docker login ghcr.io -u <github-username> --password-stdin
#   3. Enable QEMU (for cross-arch builds on a single host) if you build both
#      arches on one machine:
#        docker run --rm --privileged multiarch/qemu-user-static --reset -p yes
# ===========================================================================
set -eu

OWNER="motioneso"
IMAGE="ghcr.io/${OWNER}/jarv1s"
PLATFORMS="linux/amd64,linux/arm64"

log()  { printf '\n\033[1m>> %s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
die()  { printf '\033[31m   x %s\033[0m\n' "$*" >&2; exit 1; }

# Must run from the repo root.
[ -f "./Dockerfile" ] || die "run from the repo root (Dockerfile must be present)."

# --- prereqs ---------------------------------------------------------------
docker buildx version >/dev/null 2>&1 \
  || die "docker buildx not available. Install the buildx plugin, then: docker buildx create --use"

# Best-effort GHCR login probe: docker stores registry creds in its config. A
# missing ghcr.io entry means the `--push` below will fail with an opaque 401.
if ! grep -q '"ghcr.io"' "${HOME}/.docker/config.json" 2>/dev/null; then
  die "not logged in to ghcr.io (no ghcr.io entry in ~/.docker/config.json).\n     echo \"<PAT>\" | docker login ghcr.io -u <github-user> --password-stdin\n     (the PAT needs write:packages)."
fi

# Ensure a builder is active (buildx requires a non-default driver for multi-arch).
if ! docker buildx inspect --bootstrap >/dev/null 2>&1; then
  note "no active buildx builder — creating one..."
  docker buildx create --use || die "failed to create a buildx builder."
fi

# --- resolve tag -----------------------------------------------------------
TAG="${1:-}"
if [ -z "$TAG" ]; then
  if ! TAG=$(git describe --tags --always 2>/dev/null); then
    die "no TAG argument and 'git describe' failed — pass a tag: $0 v1.2.3"
  fi
fi
note "publishing tag: ${TAG}  platforms: ${PLATFORMS}"

# --- build + push ----------------------------------------------------------
log "Build + push ${IMAGE}:${TAG} (and :latest)"
docker buildx build \
  --platform "${PLATFORMS}" \
  --tag "${IMAGE}:${TAG}" \
  --tag "${IMAGE}:latest" \
  --push \
  -f ./Dockerfile . \
  || die "jarv1s image build/push failed."

log "Published"
note "  ${IMAGE}:${TAG}  (+ :latest)"
note "Operators now deploy with:  JARVIS_IMAGE_TAG=${TAG} ./install.sh"
