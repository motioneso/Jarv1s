import { HttpError } from "@jarv1s/module-sdk";

export interface ParsedSkillFile {
  readonly name: string;
  readonly frontmatter: Record<string, string>;
  readonly body: string;
}

const DELIMITER = "---";

// Reconstructs the body via exact line-slice+join so uploaded skill files round-trip
// byte-identical — never trim/rewrite the content after the closing delimiter.
export function parseSkillFile(raw: string): ParsedSkillFile {
  const lines = raw.split(/\r?\n/);

  if (lines[0] !== DELIMITER) {
    throw new HttpError(400, "Skill file must start with a '---' frontmatter delimiter");
  }

  const closingIndex = lines.indexOf(DELIMITER, 1);
  if (closingIndex === -1) {
    throw new HttpError(400, "Skill file frontmatter is missing a closing '---' delimiter");
  }

  const frontmatter: Record<string, string> = {};
  for (const line of lines.slice(1, closingIndex)) {
    if (line.trim() === "") continue;
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      throw new HttpError(
        400,
        `Skill file frontmatter line is not a valid "key: value" pair: ${line}`
      );
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key === "") {
      throw new HttpError(
        400,
        `Skill file frontmatter line is not a valid "key: value" pair: ${line}`
      );
    }
    frontmatter[key] = value;
  }

  const name = frontmatter["name"];
  if (name === undefined) {
    throw new HttpError(400, "Skill file frontmatter must include a 'name' field");
  }

  const body = lines.slice(closingIndex + 1).join("\n");

  return { name, frontmatter, body };
}
