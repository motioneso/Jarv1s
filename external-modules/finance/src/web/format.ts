// external-modules/finance/src/web/format.ts
// FIN-02 (#1147) Task 11: pure display helpers. Amounts are stored in cents
// with Plaid sign convention (positive = money out); formatting keeps the
// stored sign — the feed is a ledger, not a budget view (that's FIN-03).
const currencyFormatters = new Map<string, Intl.NumberFormat>();

export function formatCents(amountCents: number, isoCurrency: string): string {
  let formatter = currencyFormatters.get(isoCurrency);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(undefined, { style: "currency", currency: isoCurrency });
    } catch {
      // Unknown/absent currency code from an upstream record: fall back to a
      // plain decimal rather than throwing mid-render.
      formatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2 });
    }
    currencyFormatters.set(isoCurrency, formatter);
  }
  return formatter.format(amountCents / 100);
}

/** "2026-07" → "July 2026" (feed month heading). */
export function monthLabel(month: string): string {
  const [year, monthIndex] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthIndex - 1, 1)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
}

/** Shift a "YYYY-MM" month by delta months (prev/next picker). */
export function shiftMonth(month: string, delta: number): string {
  const [year, monthIndex] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, monthIndex - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The browser's current "YYYY-MM" (initial feed month). */
export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** "2026-07-15" → "Wednesday · July 15" (date group heading). */
export function dayLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  const weekday = parsed.toLocaleDateString(undefined, { weekday: "long", timeZone: "UTC" });
  const day = parsed.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  });
  return `${weekday} · ${day}`;
}
