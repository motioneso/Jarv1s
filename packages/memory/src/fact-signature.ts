import { createHash } from "node:crypto";

import type { FactCategory } from "./facts-repository.js";

export function normalizeMemoryFactContent(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, " ");
}

export function createMemoryFactSignature(category: FactCategory, content: string): string {
  const normalized = `${category}::${normalizeMemoryFactContent(content)}`;
  return createHash("sha256").update(normalized).digest("hex");
}
