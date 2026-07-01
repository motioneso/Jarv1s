import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

/**
 * Regression guard for #579 — user-local timezone rendering.
 *
 * Every user-facing date/time in the web app must render in the user's *persisted*
 * locale (IANA timezone + 12/24-hour + BCP-47 region), routed through the single
 * sanctioned formatter module `apps/web/src/locale/locale-format.ts`. A bare
 * `Intl.DateTimeFormat` / `Date#toLocale*` in the frontend resolves to the *ambient*
 * browser zone, which is wrong for the user — exactly the bug #579 fixes. This guard
 * fails the gate if such an ambient call reappears anywhere under `apps/web/src`,
 * locking in the sweep and preventing backsliding.
 *
 * Scope is deliberately the web display layer. Server packages thread `timeZone`
 * explicitly (or use locale-independent `en-CA` machine keys for day comparison) and
 * are out of #579's approved scope, so they are not walked here.
 *
 * EXEMPTIONS (allowlist below) are limited to non-display uses of Intl.DateTimeFormat:
 *  - the sanctioned formatter module itself (the one place it is centralized);
 *  - `en-CA` machine-key helpers (date *keys* for streak/day math, never display).
 *  - browser timezone detection (`resolvedOptions().timeZone`) for request metadata.
 * No display site is exempt — route every user-facing date through locale-format.ts.
 */

const rootDirectory = process.cwd();
const scanRoot = join(rootDirectory, "apps", "web", "src");

const checkedExtensions = new Set([".ts", ".tsx"]);
const ignoredDirectories = new Set(["node_modules", "dist", ".turbo", "coverage"]);

/** Repo-relative paths exempt from the ambient-date ban. */
const allowlist = new Set<string>([
  // Sanctioned formatter module — the single place Intl.DateTimeFormat is allowed.
  "apps/web/src/locale/locale-format.ts",
  // en-CA machine-key helpers (YYYY-MM-DD day keys for streak math, not display).
  "apps/web/src/wellness/wellness-date-utils.ts"
]);

const ambientPattern =
  /\bnew Intl\.DateTimeFormat\b|\bIntl\.DateTimeFormat\s*\(|\.toLocaleDateString\s*\(|\.toLocaleTimeString\s*\(|\.toLocaleString\s*\(/;

interface AmbientViolation {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

const violations: AmbientViolation[] = [];

for await (const filePath of walk(scanRoot)) {
  const relativePath = relative(rootDirectory, filePath);

  if (!checkedExtensions.has(extname(filePath))) {
    continue;
  }
  if (
    allowlist.has(relativePath) ||
    relativePath.endsWith(".test.ts") ||
    relativePath.endsWith(".test.tsx")
  ) {
    continue;
  }

  const contents = await readFile(filePath, "utf8");
  const lines = contents.split(/\r\n|\r|\n/);

  lines.forEach((text, index) => {
    if (/Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/.test(text)) {
      return;
    }
    if (ambientPattern.test(text)) {
      violations.push({ path: relativePath, line: index + 1, text: text.trim() });
    }
  });
}

if (violations.length > 0) {
  console.error(
    "Ambient date/time formatting in the web display layer (route through apps/web/src/locale/locale-format.ts):"
  );
  for (const violation of violations) {
    console.error(`- ${violation.path}:${violation.line}  ${violation.text}`);
  }
  process.exitCode = 1;
} else {
  console.log("No ambient date/time formatting in the web display layer.");
}

async function* walk(directory: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return; // scan root absent (e.g. partial checkout) — nothing to check
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) {
        continue;
      }
      yield* walk(join(directory, entry.name));
      continue;
    }
    if (entry.isFile()) {
      yield join(directory, entry.name);
    }
  }
}
