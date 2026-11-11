import { beforeEach, describe, expect, it, vi } from "vitest";

const toastMocks = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMocks, Toaster: () => null }));

import * as board from "@/features/canvas/components/CanvasBoard";

describe("CanvasBoard confirm actions", () => {
  beforeEach(() => vi.clearAllMocks());

  const run = () =>
    (board as Record<string, unknown>).runConfirmAction as
      | ((action: () => Promise<void>, message: string) => Promise<boolean>)
      | undefined;

  it("turns a rejected restore into one error toast and reports failure", async () => {
    expect(run()).toBeTypeOf("function");
    await expect(
      run()!(
        () => Promise.reject(new Error("restore failed")),
        "The version could not be restored. Try again.",
      ),
    ).resolves.toBe(false);
    expect(toastMocks.error).toHaveBeenCalledTimes(1);
    expect(toastMocks.error).toHaveBeenCalledWith(
      "The version could not be restored. Try again.",
    );
  });

  it("turns a rejected Autopilot fetch into one error toast", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError("offline")));
    await expect(
      run()!(async () => {
        await fetchMock();
      }, "The layout could not be applied. Refresh and try again."),
    ).resolves.toBe(false);
    expect(toastMocks.error).toHaveBeenCalledTimes(1);
  });

  it("reports success without a toast", async () => {
    await expect(run()!(async () => undefined, "nope")).resolves.toBe(true);
    expect(toastMocks.error).not.toHaveBeenCalled();
  });
});
