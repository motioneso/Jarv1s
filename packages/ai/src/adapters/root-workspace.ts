/**
 * Shared Root-workspace predicate (#993). `decideMultiplexer` (multiplexer-resolve.ts)
 * and `makeMultiplexerUsableProbe` (module-registry/chat-multiplexer.ts) each judge
 * whether herdr is USABLE independently of whether it is installed. Before this, the
 * two copies of that check only recognized JARVIS_HERDR_ROOT_PANE/HERDR_PANE_ID, while
 * HerdrMultiplexer.resolveRoot (herdr-multiplexer.ts) also honors JARVIS_HERDR_ROOT_TAB
 * — so a tab-only deployment was resolvable at open() time but reported as "not usable"
 * everywhere else. One predicate now backs every caller so they cannot disagree.
 */
export function isRootWorkspaceConfigured(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env.JARVIS_HERDR_ROOT_TAB?.trim() ||
    env.JARVIS_HERDR_ROOT_PANE?.trim() ||
    env.HERDR_PANE_ID?.trim()
  );
}
