// external-modules/job-search/src/domain/company.ts
//
// Company names arrive from job boards in whatever shape that board's own storage happens to use,
// and several of them store a URL slug: a live board produced "solana%20foundation" (percent-
// encoded), "cleric" and "tradeify" (lowercased slugs) alongside properly-cased names in the same
// feed. Rendered verbatim those read as an API response pasted into the page — which is exactly
// what they are.
//
// Applied on BOTH sides on purpose. On the write side so newly crawled rows are stored clean; on
// the read side so the rows already in the database render clean without waiting for a re-crawl
// (the crawl only revisits a posting while it is still listed — a decoded name for a posting that
// has since dropped off the board would otherwise never arrive). Idempotent, so running it twice
// costs nothing: a name that is already clean is returned unchanged.

/** True when the string looks like a machine slug rather than a name a human typed: no uppercase
 * anywhere. A real company name may be all-lowercase as a brand choice ("thoughtbot"), and this
 * will title-case those — an acceptable trade for fixing the far more common slug case, and the
 * reason the check is "no uppercase at all" rather than anything looser. A single uppercase letter
 * anywhere ("eBay", "Fi", "OpenAI") is taken as proof the name was authored, and it is left alone. */
function looksLikeSlug(value: string): boolean {
  return value === value.toLowerCase() && /[a-z]/.test(value);
}

function titleCaseWord(word: string): string {
  const first = word[0];
  if (first === undefined) return word;
  return first.toUpperCase() + word.slice(1);
}

export function normalizeCompanyName(raw: string): string {
  let value = raw.trim();
  if (value.length === 0) return value;

  // Only attempt a decode when there is something that looks like an encoded byte, so a literal
  // "%" in a name ("100% Remote Ltd") is not fed to a decoder that would throw on it. The catch is
  // still required: "%zz" matches the pattern and is not valid encoding.
  if (/%[0-9A-Fa-f]{2}/.test(value)) {
    try {
      value = decodeURIComponent(value);
    } catch {
      // Malformed encoding — better to show the raw string than to drop the name entirely.
    }
  }

  // Slug separators become spaces before the case pass, so "acme-labs" title-cases as two words.
  if (looksLikeSlug(value)) {
    value = value.replace(/[_-]+/g, " ");
  }

  value = value.replace(/\s+/g, " ").trim();

  if (looksLikeSlug(value)) {
    value = value.split(" ").map(titleCaseWord).join(" ");
  }

  return value;
}
