import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Park Press contrast gate: parses tokens.css directly (no DOM) and asserts the
 * WCAG AA pairs the spec locks. Every value is resolved through var() chains so
 * bridge aliases (--pine -> --forest) are followed.
 */
const cssPath = new URL("../../apps/web/src/styles/tokens.css", import.meta.url);
const css = readFileSync(cssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function blockFor(selector: string): Map<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1];
  if (body === undefined) throw new Error(`selector not found in tokens.css: ${selector}`);
  const decls = new Map<string, string>();
  for (const line of body.split(";")) {
    const m = line.match(/(--[\w-]+)\s*:\s*([^;]+)/);
    if (m?.[1] && m[2]) decls.set(m[1], m[2].trim());
  }
  return decls;
}

const root = blockFor(":root");

function resolve(name: string, theme?: Map<string, string>, depth = 0): string {
  if (depth > 10) throw new Error(`var chain too deep: ${name}`);
  const raw = theme?.get(name) ?? root.get(name);
  if (!raw) throw new Error(`token not defined: ${name}`);
  const varRef = raw.match(/^var\((--[\w-]+)\)$/)?.[1];
  return varRef ? resolve(varRef, theme, depth + 1) : raw;
}

function parseColor(value: string): [number, number, number] {
  const hex = value.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex) {
    const n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  throw new Error(`not an opaque hex color (test only asserts opaque pairs): ${value}`);
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(fg: string, bg: string): number {
  const [l1, l2] = [luminance(parseColor(fg)), luminance(parseColor(bg))];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function assertPairs(theme: Map<string, string> | undefined, label: string) {
  const paper = resolve("--paper", theme);
  expect(contrast(resolve("--ink", theme), paper), `${label} ink/paper`).toBeGreaterThanOrEqual(7);
  for (const t of ["--text-muted", "--text-subtle", "--text-faint", "--accent-fg", "--gold-ink"]) {
    expect(contrast(resolve(t, theme), paper), `${label} ${t}/paper`).toBeGreaterThanOrEqual(4.5);
  }
  expect(
    contrast(resolve("--text-on-accent", theme), resolve("--btn-primary-bg", theme)),
    `${label} CTA label`
  ).toBeGreaterThanOrEqual(4.5);
  // --forest is a fill/UI-component color (text duty is --accent-fg, above):
  // WCAG 1.4.11 non-text floor, 3:1.
  expect(contrast(resolve("--forest", theme), paper), `${label} accent/paper`).toBeGreaterThanOrEqual(3);
  // Gold is decorative: 3:1 non-text floor only.
  expect(contrast(resolve("--gold", theme), paper), `${label} gold/paper`).toBeGreaterThanOrEqual(2.0);
}

describe("Park Press token contrast (WCAG AA)", () => {
  it("light theme clears AA", () => assertPairs(undefined, "light"));
  it("dark theme clears AA", () => assertPairs(blockFor('[data-theme="dark"]'), "dark"));
});

describe("national-park themes", () => {
  for (const id of ["sage", "canyon", "teal", "dusk"]) {
    it(`${id} accent clears AA on oat`, () => {
      const theme = blockFor(`[data-theme="${id}"]`);
      const paper = resolve("--paper", theme);
      expect(contrast(resolve("--forest", theme), paper)).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(resolve("--text-on-accent", theme), resolve("--forest", theme))
      ).toBeGreaterThanOrEqual(4.5);
    });
  }
});
