import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const PDF_BYTES = Buffer.from(
  `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 60>>stream
BT /F1 12 Tf 72 720 Td (Hello attachment) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>`,
  "latin1"
);

describe("bundled PDF attachment extraction", () => {
  it("extracts text with the API bundle's adjacent pdf.js worker", async () => {
    execFileSync("pnpm", ["build:api"], { cwd: root, stdio: "pipe" });

    const workerPath = join(root, "dist/pdf.worker.mjs");
    const tempDir = await mkdtemp(join(tmpdir(), "jarvis-pdf-bundle-"));
    try {
      const bundlePath = join(tempDir, "bundle.mjs");
      const entryPath = join(tempDir, "entry.ts");
      const sourcePath = resolve(root, "packages/chat/src/attachments-service.ts");
      await writeFile(
        entryPath,
        `import { extractPdfText } from ${JSON.stringify(sourcePath)};
const text = await extractPdfText(Buffer.from(${JSON.stringify(PDF_BYTES.toString("base64"))}, "base64"));
process.stdout.write(text);`
      );
      await build({
        entryPoints: [entryPath],
        bundle: true,
        platform: "node",
        target: "node24",
        format: "esm",
        outfile: bundlePath,
        absWorkingDir: root
      });
      await copyFile(workerPath, join(tempDir, "pdf.worker.mjs"));

      const output = execFileSync(process.execPath, [bundlePath], {
        cwd: dirname(bundlePath),
        encoding: "utf8"
      });
      expect(output).toContain("Hello attachment");
      expect(output).not.toContain("[PDF text extraction failed for this attachment]");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 120_000);
});
