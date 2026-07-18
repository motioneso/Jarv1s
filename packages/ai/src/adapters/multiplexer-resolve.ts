/**
 * Multiplexer selection. Precedence (grill-locked):
 *   1. JARVIS_MULTIPLEXER env override — wins, BYPASSES the install probe (a deploy
 *      escape hatch; an invalid value is a fail-fast config error).
 *   2. Explicit admin setting (chat.multiplexer = tmux|herdr) — honored only if
 *      that binary is actually installed; otherwise unavailable.
 *   3. auto — detect what is installed; tie-break herdr when running inside herdr
 *      (HERDR_ENV=1), else tmux, else the other, else unavailable.
 * decideMultiplexer is pure (no io); resolveMultiplexer binds the chosen backend.
 */
import type { ChatMultiplexerChoice } from "@jarv1s/shared";

import type { TmuxIo } from "./tmux-bridge.js";
import type { Multiplexer } from "./multiplexer.js";
import { TmuxMultiplexer } from "./tmux-multiplexer.js";
import { HerdrMultiplexer } from "./herdr-multiplexer.js";
import { isRootWorkspaceConfigured } from "./root-workspace.js";

export type MultiplexerKind = "tmux" | "herdr";
export type MultiplexerSource = "env" | "configured" | "auto";

export interface MultiplexerDecisionInput {
  readonly env: NodeJS.ProcessEnv;
  readonly configured: ChatMultiplexerChoice;
  readonly isInstalled: (bin: MultiplexerKind) => boolean;
}

export type MultiplexerDecision =
  | { readonly ok: true; readonly kind: MultiplexerKind; readonly source: MultiplexerSource }
  | { readonly ok: false; readonly reason: string };

export function decideMultiplexer(input: MultiplexerDecisionInput): MultiplexerDecision {
  const { env, configured, isInstalled } = input;

  // herdr is only USABLE if its binary is present AND a Root workspace can be resolved
  // (JARVIS_HERDR_ROOT_TAB, JARVIS_HERDR_ROOT_PANE, or the server's own HERDR_PANE_ID —
  // isRootWorkspaceConfigured is the ONE shared predicate so this can never disagree with
  // makeMultiplexerUsableProbe or HerdrMultiplexer.resolveRoot, #993). Without a Root
  // workspace, picking herdr would boot a backend that only fails at launch — so it must
  // not count as available for `auto`/`configured` resolution (Codex R2 #1).
  const herdrUsable = isInstalled("herdr") && isRootWorkspaceConfigured(env);
  const tmuxUsable = isInstalled("tmux");

  // 1. Env override wins, BYPASSES the probe (deploy escape hatch). The operator owns
  //    correctness; a missing binary or root pane fails loudly at launch (→ 503).
  const override = env.JARVIS_MULTIPLEXER?.trim().toLowerCase();
  if (override === "tmux" || override === "herdr") {
    return { ok: true, kind: override, source: "env" };
  }
  if (override !== undefined && override !== "") {
    throw new Error(`JARVIS_MULTIPLEXER must be "tmux" or "herdr"; got "${override}"`);
  }

  // 2. Explicit admin setting — honored only if actually usable.
  if (configured === "tmux") {
    return tmuxUsable
      ? { ok: true, kind: "tmux", source: "configured" }
      : {
          ok: false,
          reason: `multiplexer "tmux" is selected in admin settings but is not installed on this host`
        };
  }
  if (configured === "herdr") {
    if (herdrUsable) return { ok: true, kind: "herdr", source: "configured" };
    return {
      ok: false,
      reason: isInstalled("herdr")
        ? `multiplexer "herdr" is selected but no root pane is available (set JARVIS_HERDR_ROOT_PANE or run the API inside a herdr pane)`
        : `multiplexer "herdr" is selected in admin settings but is not installed on this host`
    };
  }

  // 3. auto — tie-break herdr when inside herdr AND herdr is usable; else tmux; else herdr; else none.
  if (env.HERDR_ENV === "1" && herdrUsable) return { ok: true, kind: "herdr", source: "auto" };
  if (tmuxUsable) return { ok: true, kind: "tmux", source: "auto" };
  if (herdrUsable) return { ok: true, kind: "herdr", source: "auto" };
  return {
    ok: false,
    reason:
      "no usable terminal multiplexer found (install tmux, or install herdr and set a root pane)"
  };
}

export interface MultiplexerResolutionInput extends MultiplexerDecisionInput {
  readonly io: TmuxIo;
}

export type MultiplexerResolution =
  | { readonly ok: true; readonly mux: Multiplexer; readonly source: MultiplexerSource }
  | { readonly ok: false; readonly reason: string };

export function resolveMultiplexer(input: MultiplexerResolutionInput): MultiplexerResolution {
  const decision = decideMultiplexer(input);
  if (!decision.ok) return decision;
  // Pass the SAME env the decision used, so the backend resolves the same root pane
  // it was judged usable with (Codex R2 #5 — don't let it fall back to process.env).
  const mux =
    decision.kind === "herdr"
      ? new HerdrMultiplexer(input.io, { env: input.env })
      : new TmuxMultiplexer(input.io, { homeBase: input.env.JARVIS_CLI_HOME_BASE });
  return { ok: true, mux, source: decision.source };
}
