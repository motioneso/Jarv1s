// external-modules/finance/src/web/index.ts
// FIN-02 (#1147): external web entry — contract v1 Root (see root.tsx). The
// bundle stays react-free: all React access goes through src/web/runtime.ts.
import { Root } from "./root";

export default { contractVersion: 1, Root };
