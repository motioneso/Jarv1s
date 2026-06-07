import { readVaultFile, vaultFileExists, writeVaultFile } from "@jarv1s/vault";
import type { VaultContext } from "@jarv1s/vault";
import type { Entity } from "@jarv1s/db";

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

function yamlStr(value: string): string {
  // Always double-quote string values to handle colons, special chars safely.
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function serializeFrontmatter(entity: Entity): string {
  const lines: string[] = [
    `jarvis_id: ${entity.id}`,
    `jarvis_type: ${entity.type}`,
    `name: ${yamlStr(entity.name)}`,
    `provenance: ${entity.provenance}`
  ];
  if (entity.life_area) lines.push(`life_area: ${yamlStr(entity.life_area)}`);
  if (entity.vault_note_path) lines.push(`vault_note_path: ${yamlStr(entity.vault_note_path)}`);
  lines.push(`updated_at: ${entity.updated_at.toISOString()}`);
  return lines.join("\n") + "\n";
}

async function readExistingBody(vaultCtx: VaultContext, path: string): Promise<string> {
  if (!(await vaultFileExists(vaultCtx, path))) return "";
  const content = await readVaultFile(vaultCtx, path);
  const match = FRONTMATTER_RE.exec(content);
  return match ? content.slice(match[0].length) : content;
}

export class VaultWriteBackService {
  async syncEntityToVault(vaultCtx: VaultContext, entity: Entity): Promise<void> {
    if (!entity.vault_note_path) return;

    const body = await readExistingBody(vaultCtx, entity.vault_note_path);
    const frontmatter = serializeFrontmatter(entity);
    const content = `---\n${frontmatter}---\n${body}`;

    await writeVaultFile(vaultCtx, entity.vault_note_path, content);
  }
}
