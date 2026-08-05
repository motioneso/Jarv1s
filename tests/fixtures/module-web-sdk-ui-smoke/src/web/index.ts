// tests/fixtures/module-web-sdk-ui-smoke/src/web/index.ts
// #1388 Foundation task 11: proves a @jarv1s/ui component renders live through
// @jarv1s/module-web-sdk's re-export + JSX shim (tests/unit/module-web-sdk-ui-smoke.test.ts),
// without touching finance's or job-search's real screens (Foundation "no screen
// changes" constraint). Calls h() directly instead of JSX so this file needs no
// jsx pragma of its own — build-external-module.ts's esbuild call still forces the
// classic h/Fragment transform on @jarv1s/ui's own *.tsx sources when it bundles them.
// Button exercises the `inject`ed h/Fragment path; Chip (which renders lucide-react's
// X icon) exercises the `alias`ed bare "react" import path.
import { Button, Chip, h } from "@jarv1s/module-web-sdk";

function Root() {
  return h(
    "div",
    { className: "module-web-sdk-ui-smoke" },
    h(Button, { variant: "primary" }, "Smoke"),
    h(Chip, { onRemove: () => {}, removeLabel: "Remove smoke chip" }, "Chip")
  );
}

export default { contractVersion: 2, Root, css: "" };
