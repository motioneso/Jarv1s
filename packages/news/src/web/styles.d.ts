// Ambient module declaration for CSS side-effect imports (e.g. `import "./styles/news-1.css"`
// in `./news-page.tsx`). Mirrors what Vite's own `vite/client` types provide for `apps/web` —
// `packages/news` doesn't depend on `vite` directly, so this is declared locally instead.
declare module "*.css";
