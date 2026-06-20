/**
 * CliChatEngineHost — the server-side engine registry + RPC method dispatch for the
 * cli-runner. It hosts a `Map<sessionKey, CliChatEngineImpl>`, serializes operations
 * per sessionKey (§4.0), and enforces the §4.1.0a SINGLE-ACTIVE-USER GATE.
 *
 * Liveness is measured on the MUX (`listLiveMuxSessions`, §4.6) UNION a server-side
 * in-flight-launch RESERVATION set — NEVER the engine Map, NEVER the api's `launching`
 * map (which is invisible here). Admission runs in ONE global async-critical-section
 * (a server-wide mutex, NOT the per-sessionKey queue). See `launch` for the full TOCTOU
 * argument.
 */

import {
  CliChatEngineImpl,
  deriveNeutralDir,
  killMuxSessionByName,
  listLiveMuxSessions,
  probeProvider,
  removeNeutralDir,
  sanitizeSessionKey,
  type ProbeProviderResult
} from "../../chat/src/live/cli-chat-engine.js";
import { CliChatUnavailableError } from "../../chat/src/live/errors.js";
import type {
  RpcLaunchParams,
  RpcLaunchResult,
  RpcProbeProviderResult,
  RpcReadNewResult,
  RpcProviderKind
} from "../../chat/src/live/rpc-contract.js";
import type { RpcInstallProviderResult } from "../../chat/src/live/install-contract.js";
import type {
  RpcBeginLoginResult,
  RpcCancelLoginResult,
  RpcPollLoginResult,
  RpcSubmitLoginTokenResult
} from "../../chat/src/live/login-contract.js";
import type { Multiplexer, ProviderKind, TmuxIo } from "@jarv1s/ai";

import { Mutex } from "./mutex.js";
import type { InstallService } from "./install-service.js";
import { LoginBadRequestError, type LoginService } from "./login-service.js";

export interface EngineHostDeps {
  readonly io: TmuxIo;
  /** Shared multiplexer backend injected into every engine (bundled tmux, §7.1). */
  readonly mux?: Multiplexer;
  /** Base for `<sessionKey>` neutral dirs (`JARVIS_CLI_NEUTRAL_BASE`, §4.1.1a). */
  readonly neutralBase: string;
  /** HOME base for transcript resolution (`JARVIS_CLI_HOME_BASE`, §7.1). */
  readonly homeBase?: string;
  /** §4.1.0a single-active-user gate ON (default) / OFF (`JARVIS_CLI_RUNNER_SINGLE_USER`). */
  readonly singleUser: boolean;
  /** Presence-only PATH probe for `probeProvider` (§4.8). */
  readonly cliPresent: (provider: ProviderKind) => Promise<boolean>;
  /** Optional multiplexer-usable check surfaced by `probeProvider` (§4.8 / §9.1). */
  readonly multiplexerUsable?: () => Promise<boolean>;
  /**
   * Out-of-lock mux-create bound (ms). A wedged tmux MUST NOT strand a reservation
   * (§4.1.0a): the launch fails with `unavailable` and the `finally` releases the key.
   * Defaults to a generous boot budget.
   */
  readonly launchTimeoutMs?: number;
  /**
   * The §A.3 on-demand install service. The host's `installProvider` (§A.2.4) delegates
   * to it; it carries its OWN per-provider lock (§A.3.1), distinct from the §4.1.0a
   * admission mutex (the install lane is volume-disjoint from admission, §A.5.1). Absent
   * ⇒ `installProvider` reports the verb is unavailable on this build.
   */
  readonly installService?: InstallService;
  /**
   * The §L.3 login service (Phase 3). The host's login verbs (§L.2) delegate to it, and the
   * §L.6.1 UNIFIED admission gate consults its `isLoginActive()` from BOTH the launch gate and
   * the beginLogin gate (login is auth-volume-exclusive with chat — UNLIKE install, which is
   * volume-disjoint and lock-only). Absent ⇒ the login verbs report unavailable on this build.
   */
  readonly loginService?: LoginService;
}

const DEFAULT_LAUNCH_TIMEOUT_MS = 40_000;

export class CliChatEngineHost {
  private readonly engines = new Map<string, CliChatEngineImpl>();
  /** §4.0 per-sessionKey serialization queues (submit can't interleave a kill). */
  private readonly queues = new Map<string, Promise<unknown>>();
  /** §4.1.0a server-side in-flight-launch reservations (NOT the api's launching map). */
  private readonly reservations = new Set<string>();
  /** §4.1.0a admission critical section (a SERVER-WIDE mutex, not the per-key queue). */
  private readonly admissionMutex = new Mutex();
  private readonly launchTimeoutMs: number;

  constructor(private readonly deps: EngineHostDeps) {
    this.launchTimeoutMs = deps.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS;
  }

  // ─── per-sessionKey serialization (§4.0) ──────────────────────────────────────

  /** Serialize an operation on one sessionKey so submit/kill/readNew never interleave. */
  private enqueue<T>(sessionKey: string, op: () => Promise<T>): Promise<T> {
    const prior = this.queues.get(sessionKey) ?? Promise.resolve();
    const next = prior.then(op, op);
    // Keep the chain but swallow rejection so a failed op doesn't poison the queue.
    this.queues.set(
      sessionKey,
      next.then(
        () => undefined,
        () => undefined
      )
    );
    return next;
  }

  // ─── launch (§4.1 + §4.1.0a single-active-user gate) ──────────────────────────

  async launch(sessionKey: string, params: RpcLaunchParams): Promise<RpcLaunchResult> {
    const key = sanitizeSessionKey(sessionKey);

    // (1) ADMISSION under the server-wide mutex. Compute liveKeys = mux ∪ reservations
    // and admit only if no DIFFERENT key is live; then atomically reserve K. This closes
    // the cross-key concurrent-launch TOCTOU (two launches both passing the gate before
    // either's jarv1s-live-<K> session exists).
    const release = await this.admissionMutex.acquire();
    try {
      if (this.deps.singleUser) {
        const liveKeys = await this.currentLiveKeys();
        for (const live of liveKeys) {
          if (live !== key) {
            throw new CliChatUnavailableError("live chat is busy with another session");
          }
        }
        // §L.6.1 UNIFIED exclusivity gate: a chat launch is also blocked while a provider login
        // is in flight (the login CLI runs same-UID and touches the auth volume — "at most one
        // untrusted CLI at a time", the #347 stand-in). Reuses the `unavailable` code, no wire change.
        if (this.deps.loginService && (await this.deps.loginService.isLoginActive())) {
          throw new CliChatUnavailableError("a provider login is in progress");
        }
      }
      this.reservations.add(key);
    } finally {
      release();
    }

    // (2) Out-of-lock mux-create + launch, BOUNDED by a timeout (§4.1.0a). The finally
    // releases the reservation on success OR any failure OR timeout — a wedged tmux can
    // never strand K and freeze the gate (fail-safe; release guaranteed by settle AND
    // by timeout).
    const engine = new CliChatEngineImpl(params.provider as ProviderKind, key, this.deps.io, {
      mux: this.deps.mux,
      homeBase: this.deps.homeBase,
      ownsDrain: true
    });
    const neutralDir = deriveNeutralDir(this.deps.neutralBase, key);

    // Keep a handle on the RAW launch promise (separate from the timeout race) so that a
    // mux-create which SUCCEEDS *after* the timeout already released the reservation can be
    // reaped immediately — we do not wait for the startup sweep or the api §5.3 reconcile.
    const launchPromise = engine.launch({
      neutralDir,
      // The in-process engine ignores personaPath when personaText is present; pass a
      // path under the neutral dir to keep types satisfied (§4.1.1a — server writes
      // the persona FILE from personaText).
      personaPath: `${neutralDir}/persona.md`,
      personaText: params.personaText,
      mcpToken: params.mcpToken,
      mcpServerUrl: params.mcpServerUrl,
      replayBatch: params.replayBatch
    });

    let timedOut = false;
    try {
      const result = await this.withTimeout(launchPromise, this.launchTimeoutMs, () => {
        timedOut = true;
      });
      // mux-create SUCCEEDED in time: register the engine so submit/readNew/kill route here.
      this.engines.set(key, engine);
      return { offset: result.offset };
    } catch (err) {
      // POST-mux-create failure handling is done inside engine.launch (it kills the mux
      // session by canonical name BEFORE removing the dir, §6.5). For a TIMEOUT the engine
      // may still be mid-create; best-effort kill the canonical name + remove the dir so a
      // late orphan can't enter liveKeys and block the gate (§4.1.0a).
      await killMuxSessionByName(this.deps.io, key).catch(() => undefined);
      await removeNeutralDir(this.deps.io, this.deps.neutralBase, key).catch(() => undefined);
      this.engines.delete(key);
      // LATE-SUCCESS ORPHAN REAP (§4.1.0a, ~the 144-147 race): when we timed out, the raw
      // launch promise is still running and may create the jarv1s-live-<key> mux session
      // AFTER the catch's one-shot kill (which fired before the create finished). Attach a
      // continuation that kills the late orphan the instant the launch settles — so a wedged
      // tmux that frees up late can never strand a foreign live session that blocks the gate.
      if (timedOut) {
        void launchPromise
          .then(
            () => true, // resolved late = a live mux session now exists; reap it
            () => false // rejected late = no late session created; nothing to reap
          )
          .then(async (resolvedLate) => {
            if (!resolvedLate) return;
            await killMuxSessionByName(this.deps.io, key).catch(() => undefined);
            await removeNeutralDir(this.deps.io, this.deps.neutralBase, key).catch(() => undefined);
            this.engines.delete(key);
          });
      }
      if (err instanceof CliChatUnavailableError) throw err;
      throw new CliChatUnavailableError("could not start the live chat session");
    } finally {
      this.reservations.delete(key);
    }
  }

  /** §4.1.0a: liveKeys = listLiveSessions-by-mux (§4.6) ∪ the reservation set. */
  private async currentLiveKeys(): Promise<Set<string>> {
    const byMux = await listLiveMuxSessions(this.deps.io);
    const set = new Set<string>(byMux);
    for (const r of this.reservations) set.add(r);
    return set;
  }

  // ─── submit / readNew / isAlive (per-sessionKey serialized) ───────────────────

  submit(sessionKey: string, text: string): Promise<void> {
    const key = sanitizeSessionKey(sessionKey);
    return this.enqueue(key, async () => {
      const engine = this.engines.get(key);
      if (!engine) throw new NotLaunchedError();
      await engine.submit(text);
    });
  }

  readNew(sessionKey: string, afterOffset: number): Promise<RpcReadNewResult> {
    const key = sanitizeSessionKey(sessionKey);
    return this.enqueue(key, async () => {
      const engine = this.engines.get(key);
      if (!engine) throw new NotLaunchedError();
      const { records, offset, complete } = await engine.readNew(afterOffset);
      return { records, offset, complete };
    });
  }

  isAlive(sessionKey: string): Promise<boolean> {
    const key = sanitizeSessionKey(sessionKey);
    return this.enqueue(key, async () => {
      const engine = this.engines.get(key);
      // No engine for the key ⇒ not alive (mirrors handle===null returning false, §4.3).
      if (!engine) return false;
      return engine.isAlive();
    });
  }

  // ─── kill (§4.5) — works WITHOUT an engine object (kill-by-mux-name) ───────────

  kill(sessionKey: string): Promise<void> {
    const key = sanitizeSessionKey(sessionKey);
    return this.enqueue(key, async () => {
      const engine = this.engines.get(key);
      if (engine) {
        // engine.kill() kills the mux session AND rm -rf's the per-session dir (§6.5).
        await engine.kill();
        this.engines.delete(key);
        return;
      }
      // Post-restart orphan: no engine object, but a live jarv1s-live-<key> mux session
      // may still exist. Kill by canonical name and remove the neutral dir (§4.5/§6.5).
      await killMuxSessionByName(this.deps.io, key);
      await removeNeutralDir(this.deps.io, this.deps.neutralBase, key);
    });
  }

  // ─── listLiveSessions (§4.6) — by mux, NOT the engine Map ──────────────────────

  async listLiveSessions(): Promise<string[]> {
    return listLiveMuxSessions(this.deps.io);
  }

  // ─── probeProvider (§4.8) — no token, no replay ───────────────────────────────

  async probeProvider(provider: RpcProviderKind): Promise<RpcProbeProviderResult> {
    const result: ProbeProviderResult = await probeProvider(provider as ProviderKind, {
      io: this.deps.io,
      cliPresent: this.deps.cliPresent,
      multiplexerUsable: this.deps.multiplexerUsable
    });
    return { status: result.status, message: result.message };
  }

  // ─── installProvider (§A.2.4) — delegates to the install service ──────────────

  /**
   * §A.2.4: delegate to the §A.3 install service. Does NOT pass through the
   * per-sessionKey queue (no session) nor the §4.1.0a admission mutex (no live engine —
   * the install lane is volume-disjoint from admission, §A.5.1); the service takes its
   * OWN per-provider lock (§A.3.1). A failed install is a TERMINAL OUTCOME
   * `{state:"error"}` (not a throw); a blocked/in-flight provider throws
   * `InstallBadRequestError` (mapped to bad_request by connection.ts).
   */
  async installProvider(provider: RpcProviderKind): Promise<RpcInstallProviderResult> {
    if (!this.deps.installService) {
      // No installer wired (e.g. a host-mode build) — surface a terminal error outcome
      // rather than a throw, so the api persists `error` and offers a retry.
      return { state: "error", message: "install service unavailable on this build" };
    }
    return this.deps.installService.installProvider(provider);
  }

  // ─── login verbs (§L.2) — non-session; unified §L.6.1 exclusivity gate ─────────

  /**
   * §L.2.2 beginLogin: admit ONLY when no live chat session AND no other login is in flight
   * (the §L.6.1 unified exclusivity gate, under the SAME admission mutex as launch). Reserve the
   * single login slot inside the lock, then start the flow outside it. A blocked/no-adapter
   * provider throws `LoginBadRequestError` (→ bad_request); a chat/login-busy rejection throws
   * `CliChatUnavailableError` (→ unavailable). No wire-contract change.
   */
  async beginLogin(provider: RpcProviderKind): Promise<RpcBeginLoginResult> {
    const svc = this.deps.loginService;
    if (!svc) throw new LoginBadRequestError("login not available on this build");
    if (!svc.hasAdapter(provider)) {
      throw new LoginBadRequestError("provider not loginable: no login adapter");
    }
    let loginId: string;
    const release = await this.admissionMutex.acquire();
    try {
      if (this.deps.singleUser && (await this.currentLiveKeys()).size > 0) {
        throw new CliChatUnavailableError("live chat is busy with another session");
      }
      // One login at a time regardless of the single-user flag (one flow slot, §L.3.1).
      if (await svc.isLoginActive()) {
        throw new CliChatUnavailableError("a provider login is already in progress");
      }
      loginId = svc.reserve(provider); // SYNC slot claim inside the lock (§L.6.1)
    } finally {
      release();
    }
    // Start the flow OUTSIDE the lock (the reservation holds the slot). On any failure the
    // service clears the flow + reaps the session (§L.3.1).
    return svc.start(loginId);
  }

  /** §L.2.3 pollLogin — re-derive status (probe + runtime smoke); a stale loginId ⇒ bad_request. */
  pollLogin(provider: RpcProviderKind, loginId: string): Promise<RpcPollLoginResult> {
    return this.requireLogin().poll(provider, loginId);
  }

  /** §L.2.3 submitLoginToken — feed the pasted code argv-free (§L.6.3); a stale loginId ⇒ bad_request. */
  submitLoginToken(
    provider: RpcProviderKind,
    loginId: string,
    token: string
  ): Promise<RpcSubmitLoginTokenResult> {
    return this.requireLogin().submitToken(provider, loginId, token);
  }

  /** §L.2.3 cancelLogin — kill the login session + release the slot. Idempotent. */
  async cancelLogin(provider: RpcProviderKind, loginId: string): Promise<RpcCancelLoginResult> {
    await this.requireLogin().cancel(provider, loginId);
    return { ok: true };
  }

  private requireLogin(): LoginService {
    if (!this.deps.loginService)
      throw new LoginBadRequestError("login not available on this build");
    return this.deps.loginService;
  }

  // ─── startup CLEAN-SLATE sweep (§4.1.0a (2) / §6.5) ───────────────────────────

  /**
   * BEFORE accepting connections: kill every `jarv1s-live-*` mux session that exists
   * AND `rm -rf` every `<sessionKey>` dir directly under the neutral base
   * UNCONDITIONALLY. A container restart kills the forked tmux server while token dirs
   * persist on the volume, so a mux-only sweep misses them. The gate guarantees ≤1 live
   * session, so a fresh process legitimately has zero — the base is cleared wholesale.
   */
  async startupSweep(): Promise<void> {
    // (a) kill any surviving mux sessions (rare after a container restart, but a fast
    // in-place restart can leave them).
    const live = await listLiveMuxSessions(this.deps.io).catch(() => [] as string[]);
    for (const key of live) {
      await killMuxSessionByName(this.deps.io, key).catch(() => undefined);
    }
    // (b) unconditionally clear every <sessionKey> dir under the neutral base.
    await this.clearNeutralBase();
    // (c) §A.3.2 install-service tools-volume sweep (DISTINCT from the auth-volume sweep
    // above): clear orphaned `.staging/*` AND GC releases not referenced by `current`.
    // Ordered here so it completes BEFORE the server accepts the first installProvider
    // (the server runs startupSweep before listen, server.ts:41).
    await this.deps.installService?.startupSweep().catch(() => undefined);
    // (d) §L.3.4 login-session sweep: kill every `jarv1s-login-*` mux session (a fast in-place
    // restart can leave one while the in-memory login flow is gone). DISTINCT from (a), which
    // only enumerates `jarv1s-live-*` chat sessions.
    await this.deps.loginService?.startupSweep().catch(() => undefined);
  }

  /** `rm -rf <neutralBase>/* ` then recreate the base dir (`0700`). */
  private async clearNeutralBase(): Promise<void> {
    // Remove children individually (not the base itself) so the mount point/volume root
    // is preserved; recreate the base so the first launch's mkdir -p is a no-op.
    const listed = await this.deps.io.run("ls", ["-A", this.deps.neutralBase]).catch(() => ({
      code: 1,
      stdout: ""
    }));
    if (listed.code === 0) {
      for (const name of listed.stdout
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)) {
        await this.deps.io
          .run("rm", ["-rf", `${this.deps.neutralBase}/${name}`])
          .catch(() => undefined);
      }
    }
    await this.deps.io.run("mkdir", ["-p", this.deps.neutralBase]).catch(() => undefined);
    await this.deps.io.run("chmod", ["700", this.deps.neutralBase]).catch(() => undefined);
  }

  // ─── helpers ──────────────────────────────────────────────────────────────────

  private async withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    onTimeout?: () => void
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => {
            onTimeout?.();
            reject(new Error("launch timed out"));
          }, ms);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Test/introspection helper: how many engines are registered. */
  liveEngineCount(): number {
    return this.engines.size;
  }
}

/** Internal marker mapped to RpcErr code "not_launched" by the dispatcher. */
export class NotLaunchedError extends Error {
  constructor() {
    super("no live session for this sessionKey");
    this.name = "NotLaunchedError";
  }
}
