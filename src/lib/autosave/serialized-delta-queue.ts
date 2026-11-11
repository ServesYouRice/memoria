import { isVersionConflict } from "@/lib/api/fetch-client";

export type AutosaveStatus =
  "saving" | "saved" | "offline/retrying" | "conflict" | "failed";

export class SerializedDeltaQueue<T extends object> {
  private pending: Partial<T> = {};
  private inFlight: Promise<void> | null = null;

  constructor(
    private version: number,
    private readonly save: (
      delta: Partial<T> & { version: number },
    ) => Promise<{ version: number }>,
    private readonly onStatus: (status: AutosaveStatus, error?: Error) => void,
  ) {}

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
        this.onStatus(
          conflict
            ? "conflict"
            : error instanceof TypeError
              ? "offline/retrying"
              : "failed",
          error,
        );
        throw error;
      }
    }
    this.onStatus("saved");
  }
}
