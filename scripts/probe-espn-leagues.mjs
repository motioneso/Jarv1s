#!/usr/bin/env node
/**
 * Probe ESPN soccer league slugs and emit verified CatalogEntry seed rows (#907 spec §4.6).
 *
 * ESPN's `{iso3}.{tier}` slug convention is NOT universal (sau.1 fails, ksa.1 works; kor.1/
 * egy.1/mar.1/nzl.1 all fail), so every slug must be probed before it lands in SPORTS_CATALOG.
 * Deliberately a manual dev script, not a CI gate — live network calls would flake builds.
 *
 * Usage:
 *   node scripts/probe-espn-leagues.mjs eng.2 eng.3 ksa.1
 *   node scripts/probe-espn-leagues.mjs --file candidates.txt   # one slug per line, # comments
 *
 * Exit 1 if any candidate fails, so a copy-paste of failures is impossible to miss.
 */
const SITE_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const DELAY_MS = 250; // rate courtesy — sequential, never a burst

async function readCandidates() {
  const args = process.argv.slice(2);
  if (args[0] === "--file") {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(args[1], "utf8");
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  }
  return args;
}

function tsQuote(value) {
  return JSON.stringify(value);
}

const slugs = await readCandidates();
if (slugs.length === 0) {
  console.error("No candidate slugs. Usage: node scripts/probe-espn-leagues.mjs eng.2 ksa.1 …");
  process.exit(1);
}

const verified = [];
const failed = [];
for (const slug of slugs) {
  await new Promise((r) => setTimeout(r, DELAY_MS));
  try {
    const res = await fetch(`${SITE_BASE}/${slug}/teams`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const league = json?.sports?.[0]?.leagues?.[0];
    const teams = league?.teams ?? [];
    if (!league || teams.length === 0) throw new Error("empty roster");
    verified.push({ slug, id: league.id, name: league.name, teamCount: teams.length });
    console.log(`OK   ${slug}  id=${league.id}  teams=${teams.length}  ${league.name}`);
  } catch (error) {
    failed.push({ slug, reason: String(error.message ?? error) });
    console.log(`FAIL ${slug}  ${String(error.message ?? error)}`);
  }
}

console.log("\n// --- paste-ready CatalogEntry rows (fill confederation per spec Appendix A) ---");
for (const v of verified) {
  console.log(`  {
    competitionKey: ${tsQuote(v.slug)},
    label: ${tsQuote(v.name)},
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: ${tsQuote(v.slug)},
    confederation: "TODO"
  },`);
}
if (failed.length > 0) {
  console.error(`\n${failed.length} candidate(s) FAILED: ${failed.map((f) => f.slug).join(", ")}`);
  process.exit(1);
}
