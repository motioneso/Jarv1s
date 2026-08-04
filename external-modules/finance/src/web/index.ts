// external-modules/finance/src/web/index.ts
// FIN-02 (#1147): external web entry — contract v2 Root (see root.tsx). The
// bundle stays react-free: all React access goes through src/web/runtime.ts.
// D9 (#1388): css travels on the contract now, not a self-injected <style> —
// the host confines and mounts it (packages/module-css-confine).
import { Root } from "./root";
import { MODULE_STYLES } from "./styles";

export default { contractVersion: 2, Root, css: MODULE_STYLES };
