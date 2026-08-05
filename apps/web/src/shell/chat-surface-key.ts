/**
 * #1284 — derives a wire-safe chat surface from a host-bound module id and a module-supplied key.
 *
 * Every `/api/chat/*` route runs `normalizeChatSurface` (packages/shared/src/chat-api.ts), which
 * enforces `/^[a-z][a-z0-9-]{1,31}$/` — 2-32 chars, lowercase letters/digits/hyphens only, no
 * colons, must start with a letter. Neither input we have can be trusted to already fit that shape:
 * `MODULE_ID_RE` (module-sdk validate.ts) is unbounded and may start with a digit, and a module's
 * key is arbitrary text. The obvious `module:<id>:<key>` concatenation also fails outright (a colon
 * is illegal) — that scheme 400s on every single turn.
 *
 * So the host hashes `(moduleId, key)` into a fixed-shape surface instead of naming one directly.
 * `:` is a safe internal separator for the pre-hash input specifically because `MODULE_ID_RE`
 * forbids it in a module id, so distinct `(id, key)` pairs cannot alias onto the same input string.
 *
 * FNV-1a rather than SHA-256: this runs in a synchronous render path (a module calls setSurfaceKey
 * from a render-triggered effect), and `crypto.subtle` is async. Collision resistance is not a
 * security boundary here — a surface is a namespace inside one already-authenticated user's own
 * account, and both inputs are host-known (the host binds moduleId at the mount site; a module
 * never supplies a raw surface, only an opaque key via `AssistantSurfaceHandleV1.setSurfaceKey`).
 *
 * A real 64-bit FNV-1a needs 64-bit integer math; JS numbers only give clean 32-bit unsigned
 * arithmetic via `>>> 0` / `Math.imul`. Two independent 32-bit lanes — one run forward over the
 * input, one run backward — stand in for that, at the same "practically no accidental collisions
 * for host-known inputs" strength this non-security use needs. The result is
 * `m-${hi}${lo}` with each lane zero-padded to 8 hex chars: 18 characters total, well under the
 * 32-char cap, with a guaranteed lowercase-letter start.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a32(input: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    // Math.imul does correct 32-bit integer multiplication; plain `*` would lose precision.
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

function toHex8(value: number): string {
  return value.toString(16).padStart(8, "0");
}

/**
 * Combine a host-held module id with a module-supplied key into a wire-safe chat surface. Never
 * throws — the output shape is fixed regardless of how hostile either input is (see the "hostile
 * inputs" test in tests/unit/app-shell-chat-surface.test.tsx).
 */
export function moduleChatSurface(moduleId: string, key: string): string {
  const input = `${moduleId}:${key}`;
  const reversed = Array.from(input).reverse().join("");
  const hi = toHex8(fnv1a32(input));
  const lo = toHex8(fnv1a32(reversed));
  return `m-${hi}${lo}`;
}
