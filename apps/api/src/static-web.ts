import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export interface StaticWebOptions {
  readonly distDir?: string;
}

const MIME: Record<string, string> = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2"
};

const SPA_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self' data:; worker-src 'self'; connect-src 'self'; " +
  "frame-ancestors 'none'; base-uri 'self'";

export function defaultWebDistDir(): string {
  return process.env.JARVIS_WEB_DIST_DIR ?? resolve(process.cwd(), "apps/web/dist");
}

export function registerStaticWeb(app: FastifyInstance, options: StaticWebOptions = {}): boolean {
  const distDir = resolve(options.distDir ?? defaultWebDistDir());
  const indexPath = join(distDir, "index.html");

  if (!existsSync(indexPath)) {
    app.log.info({ distDir }, "web dist not found; static web serving disabled");
    return false;
  }

  app.setNotFoundHandler((request, reply) => {
    void serveStaticOrSpa(request, reply, distDir, indexPath);
  });
  return true;
}

async function serveStaticOrSpa(
  request: FastifyRequest,
  reply: FastifyReply,
  distDir: string,
  indexPath: string
): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    await reply.callNotFound();
    return;
  }

  const url = request.url.split("?")[0] ?? "/";
  if (url.startsWith("/api/") || url === "/api" || url.startsWith("/health")) {
    await reply.callNotFound();
    return;
  }

  const assetPath = resolveAssetPath(distDir, url);
  if (assetPath && existsSync(assetPath) && statSync(assetPath).isFile()) {
    sendFile(reply, assetPath);
    return;
  }

  const accept = request.headers.accept ?? "";
  if (url.includes(".") || !accept.includes("text/html")) {
    await reply.callNotFound();
    return;
  }

  sendFile(reply, indexPath);
}

function resolveAssetPath(distDir: string, urlPath: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0")) {
    return undefined;
  }

  const relative = normalize(decoded.replace(/^\/+/, ""));
  const full = resolve(distDir, relative);
  if (full !== distDir && !full.startsWith(`${distDir}${sep}`)) {
    return undefined;
  }
  return full;
}

function sendFile(reply: FastifyReply, filePath: string): void {
  reply.header("Content-Type", MIME[extname(filePath)] ?? "application/octet-stream");
  reply.header("Content-Security-Policy", SPA_CSP);
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Referrer-Policy", "no-referrer");
  reply.header("X-Frame-Options", "DENY");
  reply.send(createReadStream(filePath));
}
