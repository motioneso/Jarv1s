// D9 (#1388 Phase C): confines a module's CSS to its own scope root via selector prefixing,
// enforced at the host — not shadow DOM. A structural, brace/string/comment-aware parser (not a
// regex substitution) so nested rules, comma-selector lists, and @keyframes reference-rewriting
// are handled correctly rather than pattern-matched. No CSS parser library is a real dependency
// anywhere in this workspace (postcss is only transitively present via Vite, and pnpm's strict
// linking blocks a `require`/`import` of it without a direct dependency declaration) — this file
// is hand-written rather than adding one mid-task without sign-off.

export interface ConfineCssResult {
  readonly css: string;
  /** At-rules dropped because they can't be safely scoped (e.g. `@import`, `@font-face`), for
   *  logging/diagnostics. The transform never throws — a rejected rule is dropped, not fatal. */
  readonly rejectedAtRules: readonly string[];
}

type CssNode =
  | { readonly type: "rule"; readonly selector: string; readonly nodes: CssNode[] }
  | {
      readonly type: "atrule";
      readonly name: string;
      readonly params: string;
      /** null = statement form (`@import "x";`), never had a `{ }` block. */
      readonly nodes: CssNode[] | null;
    }
  | { readonly type: "decl"; readonly text: string };

// Dropped outright regardless of statement/block form — global by nature, can't be scoped to a
// module's subtree. Not a 3-item deny-list: every category D9 calls out.
const REJECTED_ATRULES = new Set([
  "import",
  "font-face",
  "property",
  "namespace",
  "page",
  "counter-style"
]);

const ROOT_LIKE = new Set([":root", "html", "body"]);

const ANIMATION_PROP = /^(-\w+-)?animation(-name)?$/i;

function isKeyframesName(atRuleName: string): boolean {
  return /^(-\w+-)?keyframes$/i.test(atRuleName);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// ---- Tokenizer / recursive-descent parser ----

function skipString(css: string, index: number): number {
  const quote = css[index];
  let j = index + 1;
  while (j < css.length) {
    if (css[j] === "\\") {
      j += 2;
      continue;
    }
    if (css[j] === quote) return j + 1;
    j++;
  }
  return j;
}

function skipComment(css: string, index: number, end: number): number {
  const close = css.indexOf("*/", index + 2);
  return close === -1 || close >= end ? end : close + 2;
}

function findMatchingBrace(css: string, openIndex: number, hardEnd: number): number {
  let depth = 0;
  let j = openIndex;
  while (j < hardEnd) {
    const c = css[j];
    if (c === "'" || c === '"') {
      j = skipString(css, j);
      continue;
    }
    if (c === "/" && css[j + 1] === "*") {
      j = skipComment(css, j, hardEnd);
      continue;
    }
    if (c === "{") {
      depth++;
      j++;
      continue;
    }
    if (c === "}") {
      depth--;
      if (depth === 0) return j;
      j++;
      continue;
    }
    j++;
  }
  return hardEnd; // unterminated block — fail-safe: treat the rest of input as its content.
}

function splitAtRule(head: string): { name: string; params: string } {
  const rest = head.slice(1); // drop leading '@'
  const match = /^([-\w]+)\s*([\s\S]*)$/.exec(rest);
  if (!match) return { name: rest.trim(), params: "" };
  return { name: match[1] ?? "", params: (match[2] ?? "").trim() };
}

function parseBlock(css: string, start: number, end: number): CssNode[] {
  const nodes: CssNode[] = [];
  let i = start;
  while (i < end) {
    const c = css[i] as string;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "/" && css[i + 1] === "*") {
      i = skipComment(css, i, end);
      continue;
    }
    if (c === "}" || c === ";") {
      i++; // stray terminator — skip defensively rather than fail the whole stylesheet.
      continue;
    }

    const segStart = i;
    let j = i;
    let terminator: "{" | ";" | null = null;
    let parenDepth = 0;
    while (j < end) {
      const cj = css[j];
      if (cj === "'" || cj === '"') {
        j = skipString(css, j);
        continue;
      }
      if (cj === "/" && css[j + 1] === "*") {
        j = skipComment(css, j, end);
        continue;
      }
      if (cj === "(") {
        parenDepth++;
        j++;
        continue;
      }
      if (cj === ")") {
        parenDepth = Math.max(0, parenDepth - 1);
        j++;
        continue;
      }
      if (parenDepth === 0 && cj === "{") {
        terminator = "{";
        break;
      }
      if (parenDepth === 0 && cj === ";") {
        terminator = ";";
        break;
      }
      if (parenDepth === 0 && cj === "}") {
        break; // end of the enclosing block, no terminator for this segment
      }
      j++;
    }

    const head = css.slice(segStart, j).trim();

    if (terminator === "{") {
      const closeIdx = findMatchingBrace(css, j, end);
      const innerNodes = parseBlock(css, j + 1, closeIdx);
      if (head.startsWith("@")) {
        const { name, params } = splitAtRule(head);
        nodes.push({ type: "atrule", name, params, nodes: innerNodes });
      } else if (head.length > 0) {
        nodes.push({ type: "rule", selector: head, nodes: innerNodes });
      }
      i = closeIdx + 1;
      continue;
    }

    if (terminator === ";") {
      if (head.startsWith("@")) {
        const { name, params } = splitAtRule(head);
        nodes.push({ type: "atrule", name, params, nodes: null });
      } else if (head.length > 0) {
        nodes.push({ type: "decl", text: head });
      }
      i = j + 1;
      continue;
    }

    // Ran into `}` (end of enclosing block) or ran out of input with a trailing declaration.
    if (head.length > 0 && !head.startsWith("@")) {
      nodes.push({ type: "decl", text: head });
    }
    i = j;
  }
  return nodes;
}

export function parseCss(css: string): CssNode[] {
  return parseBlock(css, 0, css.length);
}

// ---- Selector splitting / prefixing ----

function splitSelectorList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < selector.length) {
    const c = selector[i];
    if (c === "'" || c === '"') {
      i = skipString(selector, i);
      continue;
    }
    if (c === "(" || c === "[") {
      depth++;
      i++;
      continue;
    }
    if (c === ")" || c === "]") {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }
    if (depth === 0 && c === ",") {
      parts.push(selector.slice(start, i).trim());
      i++;
      start = i;
      continue;
    }
    i++;
  }
  parts.push(selector.slice(start).trim());
  return parts.filter((part) => part.length > 0);
}

function prefixSelectorBranch(branch: string, scopeSelector: string): string {
  const trimmed = branch.trim();
  if (ROOT_LIKE.has(trimmed.toLowerCase())) return scopeSelector;
  return `${scopeSelector} ${trimmed}`;
}

// ---- @keyframes namespacing (two-pass: collect names, then rewrite every reference) ----

function collectKeyframeRenames(nodes: readonly CssNode[], moduleId: string): Map<string, string> {
  const renames = new Map<string, string>();
  const walk = (list: readonly CssNode[]): void => {
    for (const node of list) {
      if (node.type === "atrule") {
        if (isKeyframesName(node.name)) {
          const name = node.params.trim();
          if (name && !renames.has(name)) renames.set(name, `${name}__${moduleId}`);
        }
        if (node.nodes) walk(node.nodes);
      } else if (node.type === "rule") {
        walk(node.nodes);
      }
    }
  };
  walk(nodes);
  return renames;
}

function rewriteAnimationDecl(text: string, renames: ReadonlyMap<string, string>): string {
  const colonIdx = text.indexOf(":");
  if (colonIdx === -1) return text;
  const prop = text.slice(0, colonIdx).trim();
  if (!ANIMATION_PROP.test(prop)) return text;
  let value = text.slice(colonIdx + 1);
  for (const [original, renamed] of renames) {
    value = value.replace(new RegExp(`\\b${escapeRegExp(original)}\\b`, "g"), renamed);
  }
  return `${prop}:${value}`;
}

// ---- Tree transform ----

function transformNodes(
  nodes: readonly CssNode[],
  scopeSelector: string,
  keyframeRenames: ReadonlyMap<string, string>,
  rejectedAtRules: string[],
  insideKeyframes: boolean
): CssNode[] {
  const out: CssNode[] = [];
  for (const node of nodes) {
    if (node.type === "decl") {
      out.push({ type: "decl", text: rewriteAnimationDecl(node.text, keyframeRenames) });
      continue;
    }

    if (node.type === "rule") {
      // Keyframe selector stops (0%, 50%, to, from) are not element selectors — left untouched,
      // never split-and-prefixed like a normal rule's selector list.
      const selector = insideKeyframes
        ? node.selector
        : splitSelectorList(node.selector)
            .map((branch) => prefixSelectorBranch(branch, scopeSelector))
            .join(", ");
      out.push({
        type: "rule",
        selector,
        nodes: transformNodes(node.nodes, scopeSelector, keyframeRenames, rejectedAtRules, insideKeyframes)
      });
      continue;
    }

    const lowerName = node.name.toLowerCase();

    if (isKeyframesName(node.name)) {
      const original = node.params.trim();
      out.push({
        type: "atrule",
        name: node.name,
        params: keyframeRenames.get(original) ?? original,
        nodes: node.nodes
          ? transformNodes(node.nodes, scopeSelector, keyframeRenames, rejectedAtRules, true)
          : null
      });
      continue;
    }

    if (REJECTED_ATRULES.has(lowerName)) {
      rejectedAtRules.push(`@${node.name}`);
      continue;
    }

    // Unscoped `@layer name;` (statement form, no block) — global by construction, matches
    // D9's "unscoped @layer" rejection. Block-form `@layer name { ... }` is passthrough+recurse
    // below, same as @media/@supports/@container.
    if (lowerName === "layer" && node.nodes === null) {
      rejectedAtRules.push(`@${node.name}`);
      continue;
    }

    // Safe default for everything else (@media, @supports, @container, block-form @layer, any
    // at-rule this transform doesn't specifically recognize): passthrough the wrapper, prefix
    // selectors inside it.
    out.push({
      type: "atrule",
      name: node.name,
      params: node.params,
      nodes: node.nodes
        ? transformNodes(node.nodes, scopeSelector, keyframeRenames, rejectedAtRules, insideKeyframes)
        : null
    });
  }
  return out;
}

function stringify(nodes: readonly CssNode[]): string {
  const parts: string[] = [];
  for (const node of nodes) {
    if (node.type === "decl") {
      parts.push(`${node.text};`);
    } else if (node.type === "rule") {
      parts.push(`${node.selector}{${stringify(node.nodes)}}`);
    } else if (node.nodes === null) {
      const params = node.params ? ` ${node.params}` : "";
      parts.push(`@${node.name}${params};`);
    } else {
      const params = node.params ? ` ${node.params}` : "";
      parts.push(`@${node.name}${params}{${stringify(node.nodes)}}`);
    }
  }
  return parts.join("");
}

/**
 * Confines `css` to `[data-module="<moduleId>"]` — the host-owned scope root wrapper element
 * (apps/web/src/app.tsx's ExternalModuleMount), never something a module can supply itself.
 * Never throws: a rule this transform can't safely scope is dropped and recorded in
 * `rejectedAtRules`, mirroring loader.ts's fail-closed-per-defect pattern rather than failing
 * the whole module's styling over one bad rule.
 */
export function confineModuleCss(css: string, moduleId: string): ConfineCssResult {
  const scopeSelector = `[data-module="${escapeAttrValue(moduleId)}"]`;
  const tree = parseCss(css);
  const keyframeRenames = collectKeyframeRenames(tree, moduleId);
  const rejectedAtRules: string[] = [];
  const transformed = transformNodes(tree, scopeSelector, keyframeRenames, rejectedAtRules, false);
  return { css: stringify(transformed), rejectedAtRules };
}
