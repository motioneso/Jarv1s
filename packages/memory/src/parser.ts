const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
const H2_SPLIT_RE = /(?=^## )/m;
/** Split immediately after a blank line, keeping that blank line with the paragraph it ends. */
const PARAGRAPH_SPLIT_RE = /(?<=\n[ \t]*\n)/;
/** Split immediately after each newline, keeping the newline with the line it ends. */
const LINE_SPLIT_RE = /(?<=\n)/;

/**
 * Largest chunk we will hand the embedder, in characters.
 *
 * #1359: `## ` headings were the only split point, so a long note became one enormous chunk. The
 * embedder bounds each call to `EMBED_MAX_TOKENS` (512) and silently DISCARDS everything past it,
 * which cost real data in production: 478 note chunks exceeded the model's ceiling and the largest
 * was 1.25 MB, roughly 96% of it never indexed. English prose runs about four characters per token,
 * so 2000 characters lands just under the token bound with room for the `search_document: ` prefix.
 *
 * Splitting here is what makes that bound lossless — every part of the note reaches the index, as
 * its own searchable chunk with its own line range.
 */
const MAX_CHUNK_CHARS = 2000;

export interface TextChunk {
  text: string;
  lineStart: number;
  lineEnd: number;
}

export interface ParsedDocument {
  frontmatterText: string;
  wikilinks: string[];
  chunks: TextChunk[];
}

export function parseDocument(content: string): ParsedDocument {
  let body = content;
  let frontmatterText = "";

  const fmMatch = FRONTMATTER_RE.exec(content);
  if (fmMatch) {
    frontmatterText = fmMatch[1] ?? "";
    body = content.slice(fmMatch[0].length);
  }

  const wikilinks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = WIKILINK_RE.exec(body)) !== null) {
    const link = match[1];
    if (link) wikilinks.push(link.trim());
  }

  const chunks = splitIntoChunks(content, body);

  return { frontmatterText, wikilinks, chunks };
}

function splitIntoChunks(fullContent: string, body: string): TextChunk[] {
  const trimmed = body.trim();
  if (!trimmed) return [];

  const sections = trimmed.split(H2_SPLIT_RE).filter((s) => s.trim());
  const fmLineCount = countLines(fullContent) - countLines(body);

  const chunks: TextChunk[] = [];
  let runningLine = fmLineCount;

  for (const section of sections) {
    // Line numbers are counted off the untrimmed text so provenance still points at the source
    // file. `offset` walks through the section as we emit its parts, and the section as a whole
    // advances `runningLine` by exactly what it did before it could be split.
    let offset = 0;
    for (const part of capChunkSize(section)) {
      const newlines = countNewlines(part);
      const text = part.trim();
      // A part can be pure whitespace when a section holds a run of blank lines. Skip it: an empty
      // string is not embeddable, and the embedder rejects one outright.
      if (text) {
        chunks.push({
          text,
          lineStart: runningLine + offset,
          lineEnd: runningLine + offset + newlines
        });
      }
      offset += newlines;
    }
    runningLine += countLines(section);
  }

  return chunks;
}

/**
 * Break one section into parts no larger than `MAX_CHUNK_CHARS`, preferring natural boundaries.
 *
 * Concatenating the result reproduces the input exactly — separators stay attached to the part they
 * follow — so the caller's line arithmetic holds. Paragraphs are tried first, then lines, then a
 * blunt character cut for the pathological case of a single line longer than the budget (a minified
 * blob, or a table row pasted from a spreadsheet).
 */
function capChunkSize(section: string): string[] {
  if (section.length <= MAX_CHUNK_CHARS) return [section];

  const parts: string[] = [];
  let current = "";

  for (const paragraph of section.split(PARAGRAPH_SPLIT_RE)) {
    for (const unit of splitToBudget(paragraph)) {
      // Start a new part rather than overflow, unless we have nothing to flush yet.
      if (current && current.length + unit.length > MAX_CHUNK_CHARS) {
        parts.push(current);
        current = "";
      }
      current += unit;
    }
  }

  if (current) parts.push(current);
  return parts;
}

/** Cut an oversized paragraph down to units within budget: line boundaries first, then raw chars. */
function splitToBudget(paragraph: string): string[] {
  if (paragraph.length <= MAX_CHUNK_CHARS) return [paragraph];

  const units: string[] = [];
  let current = "";

  for (const line of paragraph.split(LINE_SPLIT_RE)) {
    if (line.length > MAX_CHUNK_CHARS) {
      if (current) {
        units.push(current);
        current = "";
      }
      for (let i = 0; i < line.length; i += MAX_CHUNK_CHARS) {
        units.push(line.slice(i, i + MAX_CHUNK_CHARS));
      }
      continue;
    }
    if (current && current.length + line.length > MAX_CHUNK_CHARS) {
      units.push(current);
      current = "";
    }
    current += line;
  }

  if (current) units.push(current);
  return units;
}

function countNewlines(text: string): number {
  return (text.match(/\n/g) ?? []).length;
}

function countLines(text: string): number {
  return (text.match(/\n/g) ?? []).length + 1;
}
