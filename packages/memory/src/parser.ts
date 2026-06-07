const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
const H2_SPLIT_RE = /(?=^## )/m;

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
    const lineCount = countLines(section);
    chunks.push({
      text: section.trim(),
      lineStart: runningLine,
      lineEnd: runningLine + lineCount - 1
    });
    runningLine += lineCount;
  }

  return chunks;
}

function countLines(text: string): number {
  return (text.match(/\n/g) ?? []).length + 1;
}
