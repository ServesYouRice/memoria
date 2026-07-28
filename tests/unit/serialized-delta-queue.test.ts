import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/fetch-client";
import { SerializedDeltaQueue } from "@/lib/autosave/serialized-delta-queue";

describe("SerializedDeltaQueue", () => {
  it("flushes edits added while a save is in flight with the server version", async () => {
    let resolveFirst!: (value: { version: number }) => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ version: number }>(
            (resolve) => (resolveFirst = resolve),
          ),
      )
      .mockResolvedValueOnce({ version: 7 });
    const queue = new SerializedDeltaQueue(5, save, vi.fn());
    queue.enqueue({ text: "first" });
    const flushing = queue.flush();
    queue.enqueue({ width: 300 });
    resolveFirst({ version: 6 });
    await flushing;

    expect(save).toHaveBeenNthCalledWith(1, { text: "first", version: 5 });
    expect(save).toHaveBeenNthCalledWith(2, { width: 300, version: 6 });
  });

  it("restores a failed delta without overwriting newer pending fields", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce({ version: 2 });
    const statuses: string[] = [];
    const queue = new SerializedDeltaQueue<{ text: string; width: number }>(
      1,
      save,
      (status) => statuses.push(status),
    );
    queue.enqueue({ text: "first", width: 100 });
    const first = queue.flush();
    queue.enqueue({ text: "newer" });
    await expect(first).rejects.toThrow("offline");
    await queue.flush();

    expect(save).toHaveBeenLastCalledWith({
      text: "newer",
      width: 100,
      version: 1,
    });
    expect(statuses).toContain("offline/retrying");
    expect(statuses.at(-1)).toBe("saved");
  });

  it("detects conflicts by typed response metadata", async () => {
    const statuses: string[] = [];
    const queue = new SerializedDeltaQueue(
      1,
      vi.fn().mockRejectedValue(
        new ApiError(409, "anything", {
          problemType: "https://memoria.local/errors/version-conflict",
        }),
      ),
      (status) => statuses.push(status),
    );
    queue.enqueue({ text: "change" });
    await expect(queue.flush()).rejects.toThrow();
    expect(statuses.at(-1)).toBe("conflict");
  });
});
