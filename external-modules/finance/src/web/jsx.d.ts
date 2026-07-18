// external-modules/finance/src/web/jsx.d.ts
// FIN-02 (#1147): self-contained JSX namespace for the classic jsxFactory
// transform (job-search precedent). @types/react is not resolvable from this
// package (external modules are outside the pnpm workspace), so intrinsic
// props are loosely typed; correctness is covered by unit tests and UAT.
declare namespace JSX {
  type Element = unknown;
  interface ElementChildrenAttribute {
    children: unknown;
  }
  interface IntrinsicElements {
    [tagName: string]: Record<string, unknown>;
  }
}
