# DOCX Chat Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` and drive this plan directly under `coordinated-build`; repo coordination rules disable execution subagents.

**Goal:** Let chat accept genuine Word `.docx` attachments, safely reject renamed non-Word ZIP files, and extract capped plain text for the existing attachment manifest path.

**Architecture:** Extend the existing attachment MIME classifier, upload-time content sniff, and `readContent` dispatch in `packages/chat/src/attachments-service.ts`. Use JSZip only at the upload trust boundary to verify the OOXML ZIP contains `word/document.xml`, then use `mammoth.extractRawText` and the existing `capText` helper when content is read.

**Tech Stack:** TypeScript, Vitest, `mammoth` 1.x, `jszip` 3.x, actor-scoped `VaultContextRunner`.

## Global Constraints

- Source of truth: `docs/superpowers/specs/2026-07-19-job-search-embedded-onboarding.md` §Resume upload, item 6.
- DOCX MIME is `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.
- Upload validation requires both `PK\x03\x04` and a `word/document.xml` ZIP entry.
- DOCX extraction uses `mammoth.extractRawText`; `ATTACHMENT_TEXT_CAP_CHARS` remains unchanged.
- Extraction failures return `[DOCX text extraction failed for this attachment]` instead of throwing.
- Add generous why-comments citing #1195 / #1193.
- No migrations or frontend changes.
- Stage explicit paths only; never merge the PR.

---

### Task 1: DOCX validation and extraction

**Files:**

- Modify: `package.json`
- Modify: `packages/chat/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `tests/fixtures/chat-attachments/resume.docx`
- Modify: `tests/integration/chat-attachments-service.test.ts`
- Modify: `packages/chat/src/attachments-service.ts`

**Interfaces:**

- Consumes: `ChatAttachmentsService.saveAttachment`, `ChatAttachmentsService.readContent`, `capText`, and the existing actor-scoped vault flow.
- Produces: DOCX classification, upload validation, extracted `AttachmentContent` text, and a committed real DOCX fixture.

- [ ] **Step 1: Add the two existing ecosystem dependencies**

Run:

```bash
pnpm --filter @jarv1s/chat add mammoth@^1.12.0 jszip@^3.10.1
pnpm add -Dw jszip@^3.10.1
```

Expected: `packages/chat/package.json` declares both runtime dependencies, root `package.json` declares JSZip for the root-owned test suite, and `pnpm-lock.yaml` resolves them. JSZip is already Mammoth's ZIP implementation, so declaring it directly adds no second ZIP stack.

- [ ] **Step 2: Generate and inspect a real DOCX fixture**

Create the fixture directory, then run this from `packages/chat` so JSZip resolves from the package that declares it:

```bash
mkdir -p ../../tests/fixtures/chat-attachments
pnpm exec node --input-type=module -e '
import { writeFile } from "node:fs/promises";
import JSZip from "jszip";
const zip = new JSZip();
zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Lane B DOCX resume fixture</w:t></w:r></w:p><w:sectPr/></w:body>
</w:document>`);
zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`);
await writeFile("../../tests/fixtures/chat-attachments/resume.docx", await zip.generateAsync({ type: "nodebuffer" }));
'
```

Verify the generated archive begins with `PK\x03\x04` and lists `word/document.xml`:

```bash
pnpm exec node --input-type=module -e '
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
const bytes = await readFile("../../tests/fixtures/chat-attachments/resume.docx");
if (!bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new Error("missing ZIP signature");
const zip = await JSZip.loadAsync(bytes);
if (!zip.file("word/document.xml")) throw new Error("missing Word document entry");
'
```

- [ ] **Step 3: Write failing service tests**

Import `JSZip`, add fixture loading, then add these behavior tests to `tests/integration/chat-attachments-service.test.ts`:

```typescript
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOCX_FIXTURE = await readFile(
  new URL("../fixtures/chat-attachments/resume.docx", import.meta.url)
);

it("extracts capped text from a genuine DOCX attachment", async () => {
  const meta = await service.saveAttachment(access, {
    fileName: "resume.docx",
    mimeType: DOCX_MIME,
    bytes: DOCX_FIXTURE
  });
  const content = await service.readContent(access, meta.id);
  if (content.kind !== "text") throw new Error("expected text content");
  expect(content.text).toContain("Lane B DOCX resume fixture");
});

it("rejects an xlsx archive renamed to docx", async () => {
  const renamedXlsx = await new JSZip()
    .file("xl/workbook.xml", "<workbook />")
    .generateAsync({ type: "nodebuffer" });
  await expect(
    service.saveAttachment(access, {
      fileName: "renamed.docx",
      mimeType: DOCX_MIME,
      bytes: renamedXlsx
    })
  ).rejects.toMatchObject({ statusCode: 415 });
});

it("returns an explicit note when DOCX extraction fails", async () => {
  const malformedDocx = await new JSZip()
    .file("word/document.xml", "not valid WordprocessingML")
    .generateAsync({ type: "nodebuffer" });
  const meta = await service.saveAttachment(access, {
    fileName: "broken.docx",
    mimeType: DOCX_MIME,
    bytes: malformedDocx
  });
  const content = await service.readContent(access, meta.id);
  if (content.kind !== "text") throw new Error("expected text content");
  expect(content.text).toBe("[DOCX text extraction failed for this attachment]");
});

it("caps extracted DOCX text with the shared truncation note", async () => {
  const zip = await JSZip.loadAsync(DOCX_FIXTURE);
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${"x".repeat(ATTACHMENT_TEXT_CAP_CHARS + 500)}</w:t></w:r></w:p></w:body>
</w:document>`
  );
  const meta = await service.saveAttachment(access, {
    fileName: "long.docx",
    mimeType: DOCX_MIME,
    bytes: await zip.generateAsync({ type: "nodebuffer" })
  });
  const content = await service.readContent(access, meta.id);
  if (content.kind !== "text") throw new Error("expected text content");
  expect(content.text).toContain("[truncated:");
  expect(content.text.length).toBeLessThan(ATTACHMENT_TEXT_CAP_CHARS + 200);
});
```

- [ ] **Step 4: Run tests and verify RED**

Run:

```bash
pnpm exec vitest run tests/integration/chat-attachments-service.test.ts
```

Expected: FAIL because DOCX MIME is not yet classified/accepted. Confirm renamed-XLSX and extraction tests fail for the missing DOCX behavior, not fixture or test syntax errors.

- [ ] **Step 5: Add minimum DOCX implementation**

In `packages/chat/src/attachments-service.ts`:

```typescript
import JSZip from "jszip";
import * as mammoth from "mammoth";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type AttachmentMimeKind = "image" | "pdf" | "docx" | "text";
```

Classify `DOCX_MIME` as `"docx"`. Make `sniffMatches` asynchronous, preserve all current image/PDF checks, and add:

```typescript
case DOCX_MIME:
  // #1195 / #1193: OOXML formats share PK magic bytes; requiring Word's main document
  // entry rejects renamed XLSX/PPTX files before untrusted bytes reach extraction.
  if (!starts([0x50, 0x4b, 0x03, 0x04])) return false;
  try {
    return (await JSZip.loadAsync(bytes)).file("word/document.xml") !== null;
  } catch {
    return false;
  }
```

Await `sniffMatches` in `saveAttachment`. Route `mimeKind === "docx"` through:

```typescript
async function extractDocxText(bytes: Buffer): Promise<string> {
  try {
    // #1195 / #1193: raw text keeps resume content on the same capped, deterministic
    // attachment-manifest path as PDFs without preserving active document formatting.
    const result = await mammoth.extractRawText({ buffer: bytes });
    return capText(result.value);
  } catch {
    return "[DOCX text extraction failed for this attachment]";
  }
}
```

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
pnpm exec vitest run tests/integration/chat-attachments-service.test.ts
```

Expected: PASS, including genuine fixture extraction, renamed-XLSX rejection, shared cap, and extraction-failure note.

- [ ] **Step 7: Run package checks**

Run:

```bash
pnpm --filter @jarv1s/chat typecheck
pnpm lint
pnpm format:check
```

Expected: all exit 0. If formatting changes are needed, run `pnpm format`, inspect only task files, and rerun focused tests.

- [ ] **Step 8: Commit green task**

```bash
git add package.json packages/chat/package.json pnpm-lock.yaml packages/chat/src/attachments-service.ts tests/integration/chat-attachments-service.test.ts tests/fixtures/chat-attachments/resume.docx docs/superpowers/plans/2026-07-19-docx-chat-attachments.md
git commit -m "feat(chat): extract text from DOCX attachments (#1195)" -m "Users can now attach Word documents in chat and Jarvis reads their text." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

Expected: one cohesive green commit. Then follow `coordinated-wrap-up`: full foundation and release-hardening gates, pre-push trio, rebase, push, open PR, report to coordinator, and do not merge.
