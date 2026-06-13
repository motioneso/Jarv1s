export type ResolutionStatus = "confirmed" | "rejected" | "cancelled";
export type AwaitOutcome = ResolutionStatus | "timeout";

interface Waiter {
  readonly settle: (outcome: AwaitOutcome) => void;
}

/**
 * Bridges the synchronous blocked tool call to the asynchronous human Approve/Deny.
 * In-memory only: a server restart mid-wait orphans the call (accepted cost).
 */
export class ConfirmationRegistry {
  private readonly waiters = new Map<string, Waiter>();

  awaitResolution(actionRequestId: string, timeoutMs: number): Promise<AwaitOutcome> {
    return new Promise<AwaitOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(actionRequestId);
        resolve("timeout");
      }, timeoutMs);

      this.waiters.set(actionRequestId, {
        settle: (outcome) => {
          clearTimeout(timer);
          this.waiters.delete(actionRequestId);
          resolve(outcome);
        }
      });
    });
  }

  /**
   * Settle the still-blocked call for this action, if one is live. Returns true when a
   * live waiter was found and unblocked, false when none was (the call already timed out,
   * was already resolved, or the server restarted mid-wait). The caller uses the false
   * return to avoid recording a "confirmed" that can never execute (drawer/DB divergence).
   */
  resolve(actionRequestId: string, status: ResolutionStatus): boolean {
    const waiter = this.waiters.get(actionRequestId);
    if (!waiter) return false;
    waiter.settle(status);
    return true;
  }

  /** True while a call is still blocked awaiting resolution for this action. */
  isAwaiting(actionRequestId: string): boolean {
    return this.waiters.has(actionRequestId);
  }
}
