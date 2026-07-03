/** Strata mark — neutral bars in currentColor, the active stratum in Pine. */
export function BrandMark({ size = 24 }: { readonly size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
      <rect x="4" y="5.5" width="13" height="3" rx="1.5" fill="currentColor" />
      <rect x="4" y="10.5" width="16" height="3" rx="1.5" fill="var(--accent)" />
      <rect x="4" y="15.5" width="9" height="3" rx="1.5" fill="currentColor" />
    </svg>
  );
}
