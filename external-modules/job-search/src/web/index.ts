// external-modules/job-search/src/web/index.ts
// Task 18 (#1302): the manifest's web.entrypoint (jarvis.module.json → dist/web/index.js).
// D9 (#1388): css travels on the contract now, not a self-injected <style> in root.tsx — the
// host confines and mounts it (packages/module-css-confine). Concatenated here, not in root.tsx,
// since assembling the contract's `css` field is this file's job, not the component tree's.
import { Root } from "./root";
import styles from "./styles.css";
import boardStyles from "./styles-board.css";
import screenStyles from "./styles-screens.css";

export default {
  contractVersion: 2,
  Root,
  css: `${styles}\n${boardStyles}\n${screenStyles}`
};
