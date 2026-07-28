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
        this.version = result.version;
      } catch (unknownError) {
        this.pending = { ...delta, ...this.pending };
        const error =
          unknownError instanceof Error
            ? unknownError
            : new Error("Autosave failed");
        this.onStatus(
          isVersionConflict(error)
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
