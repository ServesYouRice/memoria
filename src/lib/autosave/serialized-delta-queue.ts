import { isVersionConflict } from "@/lib/api/fetch-client";

export type AutosaveStatus =
  "saving" | "saved" | "offline/retrying" | "conflict" | "failed";

export interface SerializedDeltaQueueOptions {
  /** Schedules a retry and returns its cancel function. */
  schedule?: (run: () => void, delayMs: number) => () => void;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const defaultSchedule = (run: () => void, delayMs: number) => {
  const timer = setTimeout(run, delayMs);
  return () => clearTimeout(timer);
};

export class SerializedDeltaQueue<T extends object> {
  private pending: Partial<T> = {};
  private inFlight: Promise<void> | null = null;
  private retryAttempt = 0;
  private cancelRetry: (() => void) | null = null;
  private disposed = false;
  private readonly schedule: NonNullable<
    SerializedDeltaQueueOptions["schedule"]
  >;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;

  constructor(
    private version: number,
    private readonly save: (
      delta: Partial<T> & { version: number },
    ) => Promise<{ version: number }>,
    private readonly onStatus: (status: AutosaveStatus, error?: Error) => void,
    options: SerializedDeltaQueueOptions = {},
  ) {
    this.schedule = options.schedule ?? defaultSchedule;
    this.baseDelayMs = options.baseDelayMs ?? 1_000;
    this.maxDelayMs = options.maxDelayMs ?? 30_000;
  }

  /** Stop retrying; a queue is disposed when its owner unmounts. */
  dispose(): void {
    this.disposed = true;
    this.clearRetry();
  }

  private clearRetry(): void {
    this.cancelRetry?.();
    this.cancelRetry = null;
  }

  /**
   * An "offline/retrying" failure is retried with bounded exponential backoff
   * through flush(), so it never runs beside another save. Conflicts and other
   * failures wait for the user.
   */
  private scheduleRetry(): void {
    if (this.disposed) return;
    this.clearRetry();
    const delay = Math.min(
      this.maxDelayMs,
      this.baseDelayMs * 2 ** this.retryAttempt,
    );
    this.retryAttempt += 1;
    this.cancelRetry = this.schedule(() => {
      this.cancelRetry = null;
      if (this.disposed) return;
      void this.flush().catch(() => {});
    }, delay);
  }

  /**
   * Adopt a newer item version seen by the caller (another queue, a
   * collaborator, a refetch after a conflict). The version only rises.
   */
  observeVersion(version: number): void {
    if (version > this.version) this.version = version;
  }

  enqueue(delta: Partial<T>): void {
    this.pending = { ...this.pending, ...delta };
  }

  hasPending(): boolean {
    return Object.keys(this.pending).length > 0;
  }

  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.clearRetry();
    if (!this.hasPending()) return Promise.resolve();

    this.inFlight = this.run().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async run(): Promise<void> {
    while (this.hasPending()) {
      const delta = this.pending;
      this.pending = {};
      this.onStatus("saving");
      try {
        const result = await this.save({ ...delta, version: this.version });
        // A newer version observed during the flight is kept.
        this.version = Math.max(this.version, result.version);
      } catch (unknownError) {
        const error =
          unknownError instanceof Error
            ? unknownError
            : new Error("Autosave failed");
        const conflict = isVersionConflict(error);
        // A conflicted delta is dropped: replaying it on a newer version would
        // overwrite the write the version check protected (ADR-0009). Only
        // changes made after it remain. Other failures keep it for a retry.
        if (!conflict) this.pending = { ...delta, ...this.pending };
        const status: AutosaveStatus = conflict
          ? "conflict"
          : error instanceof TypeError
            ? "offline/retrying"
            : "failed";
        this.onStatus(status, error);
        if (status === "offline/retrying") this.scheduleRetry();
        else this.retryAttempt = 0;
        throw error;
      }
    }
    this.retryAttempt = 0;
    this.onStatus("saved");
  }
}
