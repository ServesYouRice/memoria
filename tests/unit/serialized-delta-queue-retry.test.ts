import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/fetch-client";
import { SerializedDeltaQueue } from "@/lib/autosave/serialized-delta-queue";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("SerializedDeltaQueue automatic retry", () => {
  it("retries an offline failure after the backoff delay without a new edit", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce({ version: 2 });
    const statuses: string[] = [];
    const queue = new SerializedDeltaQueue(1, save, (s) => statuses.push(s));
    queue.enqueue({ text: "a" });
    await expect(queue.flush()).rejects.toThrow("offline");
    expect(save).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ text: "a", version: 1 });
    expect(statuses.at(-1)).toBe("saved");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("backs off exponentially up to the cap", async () => {
    const save = vi.fn().mockRejectedValue(new TypeError("offline"));
    const queue = new SerializedDeltaQueue(1, save, vi.fn());
    queue.enqueue({ text: "a" });
    await expect(queue.flush()).rejects.toThrow();
    const expectedDelays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
    for (const [index, delay] of expectedDelays.entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(save).toHaveBeenCalledTimes(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(save).toHaveBeenCalledTimes(index + 2);
    }
    queue.dispose();
  });

  it("does not retry conflicts or other failures", async () => {
    for (const error of [new ApiError(409, "conflict"), new Error("boom")]) {
      const save = vi.fn().mockRejectedValue(error);
      const queue = new SerializedDeltaQueue(1, save, vi.fn());
      queue.enqueue({ text: "a" });
      await expect(queue.flush()).rejects.toThrow();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(save).toHaveBeenCalledTimes(1);
    }
  });

  it("never retries after dispose()", async () => {
    const save = vi.fn().mockRejectedValue(new TypeError("offline"));
    const queue = new SerializedDeltaQueue(1, save, vi.fn());
    queue.enqueue({ text: "a" });
    await expect(queue.flush()).rejects.toThrow();
    queue.dispose();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
