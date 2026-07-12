// external-modules/job-search/src/web/jsx.d.ts
// JS-06 (#935): self-contained JSX namespace for the classic jsxFactory
// transform. @types/react is not resolvable from this package (external
// modules are outside the pnpm workspace), so intrinsic props are loosely
// typed; correctness is covered by renderToString unit tests and e2e.
declare namespace JSX {
  type Element = unknown;
  interface ElementChildrenAttribute {
    children: unknown;
  }
  interface IntrinsicElements {
    [tagName: string]: Record<string, unknown>;
  }
}
