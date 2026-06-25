import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const rootDirectory = process.cwd();
const cssRoot = join(rootDirectory, "apps/web/src");
const allowedColorLiteralFile = "apps/web/src/styles/tokens.css";
const colorLiteralPattern = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)/g;
const stockIndigoPattern = /#(?:4f46e5|6366f1|4338ca|3730a3|818cf8|c7d2fe)\b/i;

interface Violation {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

const violations: Violation[] = [];

for await (const filePath of walk(cssRoot)) {
  if (extname(filePath) !== ".css") {
    continue;
  }

  const relativePath = normalizePath(relative(rootDirectory, filePath));
  const contents = await readFile(filePath, "utf8");
  const searchable = stripCssComments(contents);
  const lines = searchable.split(/\r\n|\r|\n/);
  const originalLines = contents.split(/\r\n|\r|\n/);

  lines.forEach((line, index) => {
    const hasForbiddenColorLiteral =
      relativePath !== allowedColorLiteralFile && colorLiteralPattern.test(line);
    colorLiteralPattern.lastIndex = 0;

    if (hasForbiddenColorLiteral || stockIndigoPattern.test(line)) {
      violations.push({
        path: relativePath,
        line: index + 1,
        text: originalLines[index]?.trim() ?? ""
      });
    }
  });
}

if (violations.length > 0) {
  console.error("Design-token violations:");
  console.error(`- CSS color literals must live in ${allowedColorLiteralFile}.`);
  console.error("- Stock-indigo literals are not part of the Jarv1s palette.");
  for (const violation of violations) {
    console.error(`- ${violation.path}:${violation.line} ${violation.text}`);
  }
  process.exitCode = 1;
} else {
  console.log("No design-token violations found.");
}

async function* walk(directory: string): AsyncGenerator<string> {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      yield* walk(entryPath);
      continue;
    }

    if (entry.isFile()) {
      yield entryPath;
    }
  }
}

function stripCssComments(contents: string): string {
  return contents.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\r\n]/g, " "));
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}
