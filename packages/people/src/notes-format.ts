import type { PersonStatus } from "./types.js";

export const PEOPLE_MANAGED_START = "<!-- jarvis:people:start -->";
export const PEOPLE_MANAGED_END = "<!-- jarvis:people:end -->";

export interface PeopleNoteFrontmatter {
  readonly jarvisPersonId: string | null;
  readonly displayName: string;
  readonly aliases: readonly string[];
  readonly emails: readonly string[];
  readonly phones: readonly string[];
  readonly status: Exclude<PersonStatus, "merged">;
}

export interface ParsedPeopleNote {
  readonly frontmatter: PeopleNoteFrontmatter;
  readonly body: string;
}

const ARRAY_FIELDS = new Set(["aliases", "emails", "phones"]);

function parseArrayValue(line: string): string[] | null {
  const trimmed = line.trim();
  if (trimmed === "[]") return [];
  return null;
}

function parseFrontmatterBlock(block: string): PeopleNoteFrontmatter | null {
  const values: Record<string, string | string[]> = {};
  let currentArray: string | null = null;

  for (const rawLine of block.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    const item = line.match(/^\s*-\s*(.+)$/);
    if (item && currentArray) {
      (values[currentArray] as string[]).push(item[1]!.trim());
      continue;
    }

    const match = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/);
    if (!match) return null;

    const [, key, rawValue] = match;
    currentArray = null;

    if (ARRAY_FIELDS.has(key!)) {
      const inlineArray = parseArrayValue(rawValue!);
      values[key!] = inlineArray ?? [];
      currentArray = inlineArray ? null : key!;
      continue;
    }

    values[key!] = rawValue!.trim();
  }

  const displayName = values.displayName;
  const status = values.status;
  if (typeof displayName !== "string" || displayName.trim().length === 0) return null;
  if (status !== "active" && status !== "archived") return null;

  return {
    jarvisPersonId:
      typeof values.jarvisPersonId === "string" && values.jarvisPersonId.length > 0
        ? values.jarvisPersonId
        : null,
    displayName,
    aliases: Array.isArray(values.aliases) ? values.aliases : [],
    emails: Array.isArray(values.emails) ? values.emails : [],
    phones: Array.isArray(values.phones) ? values.phones : [],
    status
  };
}

export function parsePeopleNote(content: string): ParsedPeopleNote | null {
  if (!content.startsWith("---\n")) return null;
  const end = content.indexOf("\n---", 4);
  if (end < 0) return null;

  const frontmatter = parseFrontmatterBlock(content.slice(4, end));
  if (!frontmatter) return null;

  const bodyStart = content[end + 4] === "\n" ? end + 5 : end + 4;
  return { frontmatter, body: content.slice(bodyStart) };
}

function renderArray(name: string, values: readonly string[]): string[] {
  if (values.length === 0) return [`${name}: []`];
  return [`${name}:`, ...values.map((value) => `  - ${value}`)];
}

export function formatPeopleNote(note: ParsedPeopleNote): string {
  const lines = [
    "---",
    note.frontmatter.jarvisPersonId ? `jarvisPersonId: ${note.frontmatter.jarvisPersonId}` : null,
    `displayName: ${note.frontmatter.displayName}`,
    ...renderArray("aliases", note.frontmatter.aliases),
    ...renderArray("emails", note.frontmatter.emails),
    ...renderArray("phones", note.frontmatter.phones),
    `status: ${note.frontmatter.status}`,
    "---",
    note.body
  ].filter((line): line is string => line !== null);

  return lines.join("\n").replace(/\s*$/, "\n");
}

export function replaceJarvisManagedSection(body: string, managedMarkdown: string): string {
  const nextSection = `${PEOPLE_MANAGED_START}\n${managedMarkdown.trim()}\n${PEOPLE_MANAGED_END}`;
  const pattern = new RegExp(`${PEOPLE_MANAGED_START}[\\s\\S]*?${PEOPLE_MANAGED_END}`);

  if (pattern.test(body)) {
    return body.replace(pattern, nextSection);
  }

  return `${body.replace(/\s*$/, "")}\n\n${nextSection}\n`;
}
