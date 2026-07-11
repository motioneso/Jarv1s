// external-modules/job-search/src/adapters/sanitize.ts
//
// JS-04 (#933): untrusted-content sanitizer for source adapters. Board API
// bodies and user-pasted job text are attacker-controlled twice over: they
// can carry active markup (script/style/iframe payloads) AND prompt-injection
// prose aimed at the downstream AI. Everything here reduces external HTML to
// inert plain text — tags stripped, dangerous element CONTENT dropped (not
// just the tags), entities decoded without smuggling control chars or
// surrogate halves, whitespace normalized, size capped BEFORE scanning so an
// oversized body can't burn CPU. The output is DATA for storage and prompts,
// never instructions.
//
// Deliberately a linear-time hand-rolled scanner: never regex over the whole
// document with nested quantifiers (external HTML is attacker-controlled CPU,
// see the ReDoS discipline in the JS-04 plan Task 2).

const MAX_HTML_CHARS = 262_144;

// Elements whose text content must vanish entirely — leaking a <script> body
// into "plain text" would hand injection prose straight to the AI.
const DROP_CONTENT = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "object",
  "embed",
  "svg",
  "head"
]);

// Block-level boundaries become newlines so job descriptions keep paragraph
// structure after tag stripping; collapse() bounds runs to one blank line.
const BLOCK = new Set([
  "p",
  "div",
  "br",
  "li",
  "ul",
  "ol",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "tr",
  "table",
  "section",
  "article",
  "header",
  "footer",
  "blockquote",
  "pre"
]);

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™"
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]{1,7}|[a-zA-Z]{2,10});/g, (whole, body: string) => {
    if (body[0] !== "#") return NAMED[body.toLowerCase()] ?? whole;
    const cp =
      body[1]?.toLowerCase() === "x"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
    if (!Number.isInteger(cp) || cp <= 0 || cp > 0x10ffff) return "";
    // Surrogate halves would produce ill-formed strings that break on
    // re-encode; control chars are a smuggling channel — drop both outright.
    if (cp >= 0xd800 && cp <= 0xdfff) return "";
    if (cp < 0x20 && cp !== 0x0a && cp !== 0x09) return "";
    if (cp >= 0x7f && cp <= 0x9f) return "";
    return String.fromCodePoint(cp);
  });
}

function collapse(text: string): string {
  return (
    text
      .replace(/\r\n?/g, "\n")
      // Raw C0/C1 scrub (keep \t until the [ \t]+ collapse below, keep \n).
      // eslint-disable-next-line no-control-regex -- deliberate control-char scrub
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/ ?\n ?/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

export function stripHtmlToText(input: string): string {
  // Cap BEFORE scanning: output derives from the prefix only, so a 10 MB
  // hostile body costs the same as a 256 KB one.
  const html = input.length > MAX_HTML_CHARS ? input.slice(0, MAX_HTML_CHARS) : input;
  const lower = html.toLowerCase();
  let out = "";
  let i = 0;
  while (i < html.length) {
    if (html[i] !== "<") {
      out += html[i];
      i += 1;
      continue;
    }
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      if (end === -1) break; // unterminated comment: drop the remainder
      i = end + 3;
      continue;
    }
    const close = html.indexOf(">", i + 1);
    if (close === -1) break; // unterminated tag: drop the remainder
    const raw = lower.slice(i + 1, close).trim();
    const isEnd = raw.startsWith("/");
    const name = (isEnd ? raw.slice(1) : raw).split(/[\s/]/, 1)[0] ?? "";
    if (!isEnd && DROP_CONTENT.has(name)) {
      const closer = lower.indexOf(`</${name}`, close + 1);
      if (closer === -1) break; // unterminated dangerous block: drop the rest
      const closerEnd = html.indexOf(">", closer);
      if (closerEnd === -1) break;
      i = closerEnd + 1;
      continue;
    }
    if (BLOCK.has(name)) out += "\n";
    i = close + 1;
  }
  return collapse(decodeEntities(out));
}

export function sanitizeInlineField(input: string, maxChars: number): string {
  const text = stripHtmlToText(input).replace(/\n+/g, " ").trim();
  return text.length > maxChars ? text.slice(0, maxChars).trim() : text;
}
