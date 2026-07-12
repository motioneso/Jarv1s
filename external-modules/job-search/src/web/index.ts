// external-modules/job-search/src/web/index.ts
// JS-06 (#935): external web entry — contract v1 Root (see root.tsx). The
// bundle stays react-free: all React access goes through src/web/runtime.ts.
import { Root } from "./root";

export default { contractVersion: 1, Root };
