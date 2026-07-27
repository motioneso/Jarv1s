// external-modules/job-search/src/web/jsx.d.ts
// Task 18 (#1302): self-contained JSX namespace for the classic jsxFactory transform
// (finance/src/web/jsx.d.ts is a verbatim port of this file). @types/react is not resolvable
// from this package (external modules are outside the pnpm workspace), so intrinsic props are
// loosely typed; correctness is covered by unit tests and UAT.
declare namespace JSX {
  type Element = unknown;
  interface ElementChildrenAttribute {
    children: unknown;
  }
  interface IntrinsicElements {
    [tagName: string]: Record<string, unknown>;
  }
}
