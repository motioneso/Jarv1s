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

  resolve(actionRequestId: string, status: ResolutionStatus): void {
    this.waiters.get(actionRequestId)?.settle(status);
  }
}
