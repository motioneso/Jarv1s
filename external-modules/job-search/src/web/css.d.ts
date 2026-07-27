// external-modules/job-search/src/web/css.d.ts
// Task 18 (#1302): the web build (scripts/build-external-module.ts) loads `.css` imports as
// raw text via esbuild's `text` loader, so `styles.css`'s contents become the default export
// at bundle time — injected into the page via one `<style>` tag in root.tsx. This ambient
// declaration only affects this package's own `tsc -p` program (see ../../tsconfig.json),
// never the root workspace's typecheck.
declare module "*.css" {
  const css: string;
  export default css;
}
