/**
 * Concurrency serializer for SweepController contract operations.
 *
 * The SweepController contract maintains a single global nonce counter.
 * If two claims execute concurrently, they can read the same nonce,
 * resulting in on-chain signature verification failure for one of the claims.
 *
 * This lock serializes the read-nonce -> sign -> execute_sweep sequence
 * per controller contract ID with bounded timeouts and guaranteed release.
 */
export class SweepNonceLock {
  private static queues = new Map<string, Promise<void>>();

  /**
   * Acquires the lock for a given key, executes the critical section,
   * and guarantees release on both success and failure.
   *
   * @param key Lock identifier (typically sweepControllerContractId)
   * @param fn Async critical section to execute under lock
   * @param timeoutMs Maximum duration to wait before timing out (default 30s)
   */
  public async acquire<T>(
    key: string,
    fn: () => Promise<T>,
    timeoutMs = 30000,
  ): Promise<T> {
    const currentQueue = SweepNonceLock.queues.get(key) ?? Promise.resolve();

    let releaseLock: () => void;
    const nextQueue = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    // Update queue atomically
    SweepNonceLock.queues.set(
      key,
      currentQueue.then(
        () => nextQueue,
        () => nextQueue,
      ),
    );

    // Wait for preceding operation with timeout guard
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(
          new Error(
            SweepNonceLock timeout after ms waiting for lock on ,
          ),
        );
      }, timeoutMs);
    });

    try {
      await Promise.race([currentQueue, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }

    try {
      return await fn();
    } finally {
      releaseLock!();
    }
  }

  /**
   * Resets all active locks. Intended for testing environments only.
   */
  public static reset(): void {
    SweepNonceLock.queues.clear();
  }
}

export const defaultSweepNonceLock = new SweepNonceLock();