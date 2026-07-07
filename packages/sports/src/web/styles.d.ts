// Ambient module declaration for CSS side-effect imports (e.g. `import "./styles/sports-1.css"`
// in `./sports-page.tsx`). Mirrors what Vite's own `vite/client` types provide for `apps/web` —
// `packages/sports` doesn't depend on `vite` directly, so this is declared locally instead.
declare module "*.css";
