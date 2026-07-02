import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const rootDirectory = process.cwd();
const cssRoot = join(rootDirectory, "apps/web/src");
const allowedColorLiteralFile = "apps/web/src/styles/tokens.css";
const colorLiteralPattern = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)/g;
const stockIndigoPattern = /#(?:4f46e5|6366f1|4338ca|3730a3|818cf8|c7d2fe)\b/i;
const varUsagePattern = /var\(\s*(--[a-zA-Z0-9-]+)/g;

// Tokens that are injected at runtime or scoped to specific components
const allowList = new Set([
  "--ev", // Calendar event color injection
  "--cal-h",
  "--em-tint",
  "--em-soft",
  "--em-ink"
]);

interface Violation {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

// 1. Parse tokens.css to find all defined tokens
const tokensFile = await readFile(join(rootDirectory, allowedColorLiteralFile), "utf8");
const validTokens = new Set<string>();
const tokenDefPattern = /^\s*(--[a-zA-Z0-9-]+)\s*:/gm;
let match;
while ((match = tokenDefPattern.exec(tokensFile)) !== null) {
  if (match[1]) validTokens.add(match[1]);
}

// 2. Concrete Negative Test
function selfTest() {
  const mockLine = "color: var(--intentionally-undefined-test-var);";
  varUsagePattern.lastIndex = 0;
  const testMatch = varUsagePattern.exec(mockLine);
  if (!testMatch || !testMatch[1] || validTokens.has(testMatch[1]) || allowList.has(testMatch[1])) {
    console.error("Self-test failed: token guard did not catch --intentionally-undefined-test-var");
    process.exit(1);
  }
}
selfTest();

const violations: Violation[] = [];

for await (const filePath of walk(cssRoot)) {
  const ext = extname(filePath);
  if (ext !== ".css" && ext !== ".ts" && ext !== ".tsx") {
    continue;
  }

  const relativePath = normalizePath(relative(rootDirectory, filePath));
  const contents = await readFile(filePath, "utf8");
  const searchable = stripCssComments(contents);
  const lines = searchable.split(/\r\n|\r|\n/);
  const originalLines = contents.split(/\r\n|\r|\n/);

  lines.forEach((line, index) => {
    if (ext === ".css") {
      const hasForbiddenColorLiteral =
        relativePath !== allowedColorLiteralFile && colorLiteralPattern.test(line);
      colorLiteralPattern.lastIndex = 0;

      if (hasForbiddenColorLiteral || stockIndigoPattern.test(line)) {
        violations.push({
          path: relativePath,
          line: index + 1,
          text: `Forbidden literal: ${originalLines[index]?.trim() ?? ""}`
        });
      }
    }

    varUsagePattern.lastIndex = 0;
    let varMatch;
    while ((varMatch = varUsagePattern.exec(line)) !== null) {
      const tokenName = varMatch[1];
      if (tokenName && !validTokens.has(tokenName) && !allowList.has(tokenName)) {
        violations.push({
          path: relativePath,
          line: index + 1,
          text: `Undefined token ${tokenName}: ${originalLines[index]?.trim() ?? ""}`
        });
      }
    }
  });
}

if (violations.length > 0) {
  console.error("Design-token violations:");
  console.error(`- CSS color literals must live in ${allowedColorLiteralFile}.`);
  console.error("- Stock-indigo literals are not part of the Jarv1s palette.");
  console.error("- All var(--...) tokens must be defined in tokens.css.");
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
