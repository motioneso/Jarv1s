import { describe, expect, it } from "vitest";

import { confineModuleCss } from "../../packages/module-css-confine/src/confine.ts";

/**
 * D9 (#1388): module CSS is confined by selector prefixing, enforced at the host. Fixtures below
 * cover the three load-bearing constraints from the spec plus the explicit adversarial cases it
 * calls out (a class-name collision with a host `.jds-*` primitive, a comma-selector-list escape
 * attempt, and an `@keyframes` name collision with the host).
 */

describe("confineModuleCss (D9)", () => {
  it("prefixes a class selector to the module's data-module scope", () => {
    const result = confineModuleCss(".card { color: red; }", "widgets");
    expect(result.css).toBe('[data-module="widgets"] .card{color: red;}');
    expect(result.rejectedAtRules).toEqual([]);
  });

  it("scopes a host-primitive class-name collision instead of letting it leak globally", () => {
    // A module declaring `.jds-btn { display: none }` must never affect the host's own buttons —
    // scoping is what prevents that, not naming discipline the module has no obligation to follow.
    const result = confineModuleCss(".jds-btn { display: none; }", "evil-module");
    expect(result.css).toBe('[data-module="evil-module"] .jds-btn{display: none;}');
  });

  it("prefixes every branch of a comma-separated selector list — no escaping via the list", () => {
    // A naive single-selector prefixer could be escaped by appending an unprefixed branch after a
    // comma. Every branch must independently receive the scope prefix.
    const result = confineModuleCss("h1, .title, #hero { color: blue; }", "mod");
    expect(result.css).toBe(
      '[data-module="mod"] h1, [data-module="mod"] .title, [data-module="mod"] #hero{color: blue;}'
    );
  });

  it("rewrites :root, html, and body to the scope selector itself rather than descendant-prefixing", () => {
    const result = confineModuleCss(
      ":root { --x: 1; } html { margin: 0; } body { padding: 0; }",
      "mod"
    );
    expect(result.css).toBe(
      '[data-module="mod"]{--x: 1;}[data-module="mod"]{margin: 0;}[data-module="mod"]{padding: 0;}'
    );
  });

  it("namespaces @keyframes and rewrites every animation/animation-name reference to match", () => {
    // A module naming its animation `spin` — colliding with a host `@keyframes spin` — must not
    // hijack (or be hijacked by) the host's animation. Every reference must be rewritten, not just
    // the @keyframes declaration itself.
    const css = `
      @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      .loader { animation: spin 1s linear infinite; }
      .other { animation-name: spin; }
    `;
    const result = confineModuleCss(css, "mod");
    expect(result.css).toContain("@keyframes spin__mod{");
    expect(result.css).toContain("animation: spin__mod 1s linear infinite;");
    expect(result.css).toContain("animation-name: spin__mod;");
    expect(result.css).not.toMatch(/animation:\s*spin\s/);
  });

  it("does not prefix keyframe selector stops (percentages, from/to) as if they were element selectors", () => {
    const result = confineModuleCss(
      "@keyframes fade { 0% { opacity: 0; } 50% { opacity: 0.5; } to { opacity: 1; } }",
      "mod"
    );
    expect(result.css).toBe(
      "@keyframes fade__mod{0%{opacity: 0;}50%{opacity: 0.5;}to{opacity: 1;}}"
    );
  });

  it("passes through @media/@supports while still prefixing selectors nested inside", () => {
    const result = confineModuleCss(
      "@media (min-width: 40rem) { .grid { display: grid; } }",
      "mod"
    );
    expect(result.css).toBe('@media (min-width: 40rem){[data-module="mod"] .grid{display: grid;}}');
  });

  it("rejects @import, @font-face, @property, @namespace, @page, and @counter-style", () => {
    const css = `
      @import url("evil.css");
      @font-face { font-family: "Evil"; src: url("evil.woff2"); }
      @property --x { syntax: "<color>"; inherits: false; initial-value: red; }
      @namespace svg url(http://www.w3.org/2000/svg);
      @page { margin: 1in; }
      @counter-style thumbs { system: cyclic; symbols: "👍"; }
      .safe { color: green; }
    `;
    const result = confineModuleCss(css, "mod");
    expect(result.rejectedAtRules).toEqual(
      expect.arrayContaining([
        "@import",
        "@font-face",
        "@property",
        "@namespace",
        "@page",
        "@counter-style"
      ])
    );
    expect(result.css).toBe('[data-module="mod"] .safe{color: green;}');
  });

  it("rejects an unscoped @layer statement but passes through a block-form @layer", () => {
    const unscoped = confineModuleCss("@layer utilities;", "mod");
    expect(unscoped.rejectedAtRules).toEqual(["@layer"]);

    const blockForm = confineModuleCss("@layer utilities { .x { color: red; } }", "mod");
    expect(blockForm.rejectedAtRules).toEqual([]);
    expect(blockForm.css).toBe('@layer utilities{[data-module="mod"] .x{color: red;}}');
  });

  it("never throws on malformed input", () => {
    expect(() => confineModuleCss("{ this is not valid css at all", "mod")).not.toThrow();
    expect(() => confineModuleCss("", "mod")).not.toThrow();
  });

  it("escapes a module id containing a double quote in the scope attribute selector", () => {
    const result = confineModuleCss(".x { color: red; }", 'mod"><script>');
    expect(result.css).toBe('[data-module="mod\\"><script>"] .x{color: red;}');
  });
});
