/**
 * A minimal async mutex (FIFO). Used for the §4.1.0a admission critical-section — a
 * single SERVER-WIDE lock under which the cli-runner computes liveKeys and atomically
 * reserves a sessionKey, so two concurrent cross-key launches can never both pass the
 * gate. `acquire()` resolves to a `release` function; call it exactly once.
 */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prior = this.tail;
    this.tail = this.tail.then(() => next);
    await prior;
    return release;
  }
}
